"""Bruce Wayne demo account seed data and reset logic.

A rolling 3-month dataset ending at the current month for the public demo account.
Rich DC-lore references woven into every line item.

Reset strategy: the Celery beat task calls reset_demo_data() every 30 minutes,
which wipes all expenses/budgets/ledgers for Bruce Wayne and re-inserts the
canonical seed rows.  Categories and partner links are seeded once and left alone.
"""

from __future__ import annotations

import base64
import calendar as _cal
import uuid
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.budget import Budget
from app.models.category import Category
from app.models.chat_session import ChatSession
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.ledger import Ledger, LedgerMembership
from app.models.partner import PartnerRequest
from app.models.user import User
from app.services.cache import invalidate_analytics_cache
from app.services.spendhound import ensure_default_categories

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Avatar helper — inline SVG data URI, no external dependency, CSP-safe
# ---------------------------------------------------------------------------

def _avatar_svg(initials: str, bg: str, fg: str) -> str:
    """Return a data:image/svg+xml;base64 URI for an initials avatar.

    Allowed by the existing img-src CSP (data: is whitelisted) and requires
    no network access, so it works in every environment including Docker.
    """
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
        f'<rect width="40" height="40" rx="20" fill="{bg}"/>'
        f'<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" '
        f'fill="{fg}" font-family="system-ui,ui-sans-serif,sans-serif" '
        f'font-size="15" font-weight="700">{initials}</text>'
        f'</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


# ---------------------------------------------------------------------------
# Identity constants
# ---------------------------------------------------------------------------

_DEMO_NS = uuid.UUID("deadbeef-dead-beef-dead-beefdeadbeef")


def _did(name: str) -> uuid.UUID:
    """Deterministic UUID from name, scoped to the demo namespace."""
    return uuid.uuid5(_DEMO_NS, name)


def _month_start(months_ago: int = 0) -> date:
    """First day of the month N months before today."""
    today = date.today()
    total = today.year * 12 + today.month - 1 - months_ago
    y, m = divmod(total, 12)
    return date(y, m + 1, 1)


def _day(months_ago: int, day: int) -> date:
    """Date at the given calendar day in the month N months before today.

    For the current month (months_ago=0) the day is capped to today so no
    future-dated seed rows are ever inserted.
    """
    start = _month_start(months_ago)
    last = _cal.monthrange(start.year, start.month)[1]
    effective = min(day, last)
    if months_ago == 0:
        effective = min(effective, date.today().day)
    return date(start.year, start.month, effective)


DEMO_USER_EMAIL = "bruce.wayne@wayneenterprises.com"

BRUCE_WAYNE_ID = _did(DEMO_USER_EMAIL)
ALFRED_ID = _did("alfred.pennyworth@waynemanor.com")
LUCIUS_ID = _did("lucius.fox@wayneenterprises.com")
CLARK_ID = _did("clark.kent@dailyplanet.com")

_LEDGER_MANOR_ID = _did("ledger:wayne-manor-ops")
_LEDGER_FOX_ID = _did("ledger:fox-wayne-labs")
_LEDGER_JL_ID = _did("ledger:jl-petty-cash")

# ---------------------------------------------------------------------------
# Peter Parker (Spider-Man) demo account
# ---------------------------------------------------------------------------

PETER_PARKER_EMAIL = "peter.parker@dailybugle.com"

PETER_PARKER_ID = _did(PETER_PARKER_EMAIL)
MJ_ID = _did("mj.watson@empire-state.edu")
NED_ID = _did("ned.leeds@empire-state.edu")
AUNT_MAY_ID = _did("may.parker@queens.ny.us")
HAPPY_ID = _did("happy.hogan@starkindustries.com")

_LEDGER_PARKER_LAB_ID = _did("ledger:parker-lab-with-ned")
_LEDGER_AVENGERS_ID = _did("ledger:avengers-petty-cash-peter")
_LEDGER_MAY_ID = _did("ledger:may-parker-household")

# ---------------------------------------------------------------------------
# Custom category names (beyond the 17 defaults)
# ---------------------------------------------------------------------------

_BRUCE_CUSTOM_CATS = [
    ("Crime Fighting", "#7c3aed", "shield", "debit"),
    ("Wayne Foundation", "#2563eb", "heart-handshake", "debit"),
    ("WayneTech R&D", "#ea580c", "cpu", "debit"),
]

_PETER_CUSTOM_CATS = [
    ("Crime Fighting", "#dc2626", "shield", "debit"),
    ("Web Fluid R&D", "#1d4ed8", "cpu", "debit"),
    ("Parker Industries", "#7c3aed", "camera", "debit"),
]


# ---------------------------------------------------------------------------
# Expense item helpers
# ---------------------------------------------------------------------------

def _item(desc: str, qty: float | None, unit: float | None, total: float, subcat: str | None = None) -> dict:
    return {"description": desc, "quantity": qty, "unit_price": unit, "total": total, "subcategory": subcat, "subcategory_confidence": 0.92 if subcat else None}


# Grocery items for each month's Alfred run
_M2_GROCERY_ITEMS = [
    _item("Organic dark chocolate 85% x12 bars", 12, 4.50, 54.00, "Snacks"),
    _item("Free-range chicken breast x2", 2, 14.80, 29.60, "Meat"),
    _item("Uova bio (eggs) x12", 1, 3.20, 3.20, "Dairy & Eggs"),
    _item("San Pellegrino sparkling water 1.5L x12", 12, 1.40, 16.80, "Beverages"),
    _item("Whole milk 1L x6", 6, 1.35, 8.10, "Dairy & Eggs"),
    _item("Alfred's sourdough bread x2", 2, 3.90, 7.80, "Bakery"),
    _item("Fresh seasonal vegetables", 1, 8.50, 8.50, "Vegetables"),
    _item("Bio muesli 500g x3", 3, 4.80, 14.40, "Breakfast & Cereal"),
    _item("Finish dishwasher pods 60ct", 1, 14.90, 14.90, "Cleaning Products"),
    _item("Scott kitchen paper roll x6", 2, 5.80, 11.60, "Household"),
    _item("Extra virgin olive oil 1L x2", 2, 8.90, 17.80, "Condiments & Spices"),
    _item("Penne rigate 500g x6", 6, 2.10, 12.60, "Pantry"),
    _item("Parmigiano Reggiano DOP 500g", 1, 12.80, 12.80, "Dairy & Eggs"),
    _item("Mozzarella di bufala x4", 4, 3.90, 15.60, "Dairy & Eggs"),
    _item("Cherry tomatoes 500g x2", 2, 2.80, 5.60, "Vegetables"),
    _item("Broccoli florets x2", 2, 1.90, 3.80, "Vegetables"),
    _item("Illy espresso beans 1kg", 1, 18.90, 18.90, "Beverages"),
    _item("Prosecco DOC bottle x2", 2, 9.90, 19.80, "Beverages"),
    _item("Assorted Italian cheese selection", 1, 18.20, 18.20, "Dairy & Eggs"),
    _item("Protein bar assortment x12", 12, 2.50, 30.00, "Snacks"),
]  # ~€345

_M1_GROCERY_ITEMS = [
    _item("Organic dark chocolate 85% x10 bars", 10, 4.50, 45.00, "Snacks"),
    _item("Wild Atlantic salmon fillet x2", 2, 22.00, 44.00, "Fish & Seafood"),
    _item("Mozzarella di bufala x3", 3, 3.90, 11.70, "Dairy & Eggs"),
    _item("Penne rigate 500g x8", 8, 2.10, 16.80, "Pantry"),
    _item("Extra virgin olive oil 750ml x2", 2, 7.90, 15.80, "Condiments & Spices"),
    _item("Prosecco DOC Treviso x3", 3, 9.90, 29.70, "Beverages"),
    _item("Alfred's ciabatta x3", 3, 3.20, 9.60, "Bakery"),
    _item("Fresh vegetable assortment", 1, 14.80, 14.80, "Vegetables"),
    _item("Free-range chicken x3", 3, 14.80, 44.40, "Meat"),
    _item("Greek yogurt 500g x6", 6, 2.40, 14.40, "Dairy & Eggs"),
    _item("San Pellegrino sparkling water x12", 12, 1.40, 16.80, "Beverages"),
    _item("Bio oat muesli x2", 2, 5.20, 10.40, "Breakfast & Cereal"),
    _item("Uova bio x12 (x2 packs)", 2, 4.20, 8.40, "Dairy & Eggs"),
    _item("Fresh herb bundle (rosemary, basil, thyme)", 3, 1.80, 5.40, "Condiments & Spices"),
    _item("Finish dishwasher pods refill", 1, 12.90, 12.90, "Cleaning Products"),
    _item("Ariel laundry detergent 3L", 1, 14.80, 14.80, "Cleaning Products"),
    _item("Fiordilatte gelato 1L x2", 2, 5.90, 11.80, "Frozen"),
    _item("Dark chocolate protein bars x12", 12, 2.50, 30.00, "Snacks"),
    _item("Espresso capsules 40ct", 1, 14.90, 14.90, "Beverages"),
]  # ~€411

_M0_GROCERY_ITEMS = [
    _item("Organic dark chocolate 85% x8 bars", 8, 4.50, 36.00, "Snacks"),
    _item("Fresh pappardelle pasta x3", 3, 3.50, 10.50, "Pantry"),
    _item("Buffalo mozzarella x3", 3, 4.90, 14.70, "Dairy & Eggs"),
    _item("Fresh summer truffle 30g (Alfred's 'non-negotiable' splurge)", 1, 54.00, 54.00, "Condiments & Spices"),
    _item("Cherry tomatoes 500g x3", 3, 2.80, 8.40, "Vegetables"),
    _item("Fresh basil bundle x2", 2, 1.80, 3.60, "Condiments & Spices"),
    _item("Prosecco DOC x2", 2, 9.90, 19.80, "Beverages"),
    _item("San Pellegrino sparkling water 1.5L x12", 12, 1.40, 16.80, "Beverages"),
    _item("Sourdough whole grain loaf x2", 2, 3.90, 7.80, "Bakery"),
    _item("Free-range eggs x12", 1, 4.20, 4.20, "Dairy & Eggs"),
    _item("Organic dark chocolate 70% x6", 6, 3.20, 19.20, "Snacks"),
    _item("Wild rocket salad x2", 2, 1.90, 3.80, "Vegetables"),
    _item("Greek yogurt 500g x4", 4, 2.40, 9.60, "Dairy & Eggs"),
    _item("Italian acacia honey 250g", 1, 8.90, 8.90, "Condiments & Spices"),
    _item("Illy espresso beans 1kg", 1, 18.90, 18.90, "Beverages"),
    _item("Protein bar assortment x10", 10, 2.50, 25.00, "Snacks"),
    _item("Finish dishwasher pods 60ct", 1, 14.90, 14.90, "Cleaning Products"),
    _item("Extra virgin olive oil 1L", 1, 8.90, 8.90, "Condiments & Spices"),
    _item("Parmigiano Reggiano DOP 250g", 1, 7.90, 7.90, "Dairy & Eggs"),
    _item("Sparkling mineral water 500ml x24", 24, 0.60, 14.40, "Beverages"),
]  # ~€296

# Peter Parker grocery items — comically cheap vs Bruce's
_M2_PETER_GROCERY_ITEMS = [
    _item("Maruchan instant ramen x24 pack", 24, 0.35, 8.40, "Pantry"),
    _item("Wonder Bread classic white x2", 2, 2.20, 4.40, "Bakery"),
    _item("Jif creamy peanut butter 40oz", 1, 5.49, 5.49, "Condiments & Spices"),
    _item("Smucker's strawberry jam", 1, 3.29, 3.29, "Condiments & Spices"),
    _item("Whole milk 1 gallon", 1, 3.80, 3.80, "Dairy & Eggs"),
    _item("Large eggs x12", 1, 2.89, 2.89, "Dairy & Eggs"),
    _item("Gatorade Blue Bolt x6 (electrolyte replenishment — not labeled as such)", 6, 1.29, 7.74, "Beverages"),
    _item("Clif Bar assorted x8 (field rations, again not labeled)", 8, 1.25, 10.00, "Snacks"),
    _item("Apples x5 (Aunt May made me)", 5, 0.50, 2.50, "Vegetables"),
    _item("Instant oatmeal packets x8", 8, 0.45, 3.60, "Breakfast & Cereal"),
]  # ~€52

_M1_PETER_GROCERY_ITEMS = [
    _item("Maruchan instant ramen x20", 20, 0.35, 7.00, "Pantry"),
    _item("Generic white bread x2 loaves", 2, 1.89, 3.78, "Bakery"),
    _item("Jif peanut butter 28oz", 1, 4.29, 4.29, "Condiments & Spices"),
    _item("Skippy grape jelly", 1, 2.99, 2.99, "Condiments & Spices"),
    _item("Lactaid milk (Ned: 'be good to yourself')", 1, 4.49, 4.49, "Dairy & Eggs"),
    _item("Large eggs x12", 1, 2.89, 2.89, "Dairy & Eggs"),
    _item("Minute Rice x2 boxes", 2, 2.49, 4.98, "Pantry"),
    _item("Campbell's soup cans x6", 6, 1.25, 7.50, "Pantry"),
    _item("Gatorade Glacier x4", 4, 1.29, 5.16, "Beverages"),
    _item("KIND bars assorted x8", 8, 1.49, 11.92, "Snacks"),
    _item("Bananas x6 (Aunt May would be proud)", 6, 0.30, 1.80, "Vegetables"),
]  # ~€57 (Stark stipend month)

_M0_PETER_GROCERY_ITEMS = [
    _item("Maruchan instant ramen x20", 20, 0.35, 7.00, "Pantry"),
    _item("Wonder Bread x1 loaf", 1, 2.20, 2.20, "Bakery"),
    _item("Jif peanut butter 16oz (small — cash flow issue)", 1, 2.99, 2.99, "Condiments & Spices"),
    _item("Generic grape jelly", 1, 1.89, 1.89, "Condiments & Spices"),
    _item("Whole milk half gallon", 1, 2.29, 2.29, "Dairy & Eggs"),
    _item("Medium eggs x12 (cheaper than large)", 1, 2.49, 2.49, "Dairy & Eggs"),
    _item("Gatorade x6 (web-swinging is dehydrating)", 6, 1.29, 7.74, "Beverages"),
    _item("Clif Bar x6", 6, 1.25, 7.50, "Snacks"),
    _item("Instant oatmeal x8 packets", 8, 0.45, 3.60, "Breakfast & Cereal"),
    _item("Apples x4 (weekly Aunt May quota)", 4, 0.50, 2.00, "Vegetables"),
    _item("Canned tuna x4 (protein, desperate times)", 4, 0.99, 3.96, "Fish & Seafood"),
]  # ~€44


# ---------------------------------------------------------------------------
# Expense seed data
# ---------------------------------------------------------------------------

# Each dict is fed directly to the Expense constructor.
# Recurring expenses share `recurring_group` so the dashboard flags them.
_RG = {  # recurring_group shortcuts
    "therapy": "dr quinzel therapy:EUR:debit:monthly:320.00",
    "manor_elec": "wayne manor electricity:EUR:debit:monthly:1840.00",
    "cave_elec": "batcave power:EUR:debit:monthly:4100.00",
    "claude": "anthropic claude code:EUR:debit:monthly:180.00",
}


def _e(
    eid: str,
    merchant: str,
    amount: str,
    cat: str,
    date_: date,
    *,
    tx: str = "debit",
    currency: str = "EUR",
    cadence: str = "one_time",
    rg: str | None = None,
    is_major: bool = False,
    notes: str | None = None,
    description: str | None = None,
    ledger_id: uuid.UUID | None = None,
    items: list[dict] | None = None,
) -> dict:
    return {
        "id": _did(eid),
        "merchant": merchant,
        "amount": Decimal(amount),
        "cat_name": cat,
        "expense_date": date_,
        "transaction_type": tx,
        "currency": currency,
        "cadence": cadence,
        "is_recurring": cadence == "monthly",
        "recurring_group": rg,
        "is_major_purchase": is_major,
        "notes": notes,
        "description": description,
        "ledger_id": ledger_id,
        "items": items or [],
    }


def _build_expenses(ledger_manor: uuid.UUID, ledger_fox: uuid.UUID, ledger_jl: uuid.UUID) -> list[dict]:
    return [

        # ── Month -2 (two months ago) ────────────────────────────────────────────

        # Big Q1 income
        _e("inc-m2-01", "Wayne Enterprises", "280000.00", "Salary", _day(2, 1), tx="credit",
           description="Q1 executive dividend — board-approved"),

        _e("m2-01", "Wayne Manor Property Management", "3200.00", "Housing", _day(2, 1),
           description="Q2 property insurance & estate levy"),

        _e("m2-02", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(2, 2),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 1: recurring nightmares, social isolation, strong aversion to clowns"),

        _e("m2-03", "Wayne Manor Estate Grid", "1840.00", "Bills", _day(2, 3),
           cadence="monthly", rg=_RG["manor_elec"],
           description="Wayne Manor electricity — billing cycle"),

        _e("m2-04", "Gotham Industrial Power Corp", "4100.00", "Bills", _day(2, 4),
           cadence="monthly", rg=_RG["cave_elec"],
           description="Sub-basement power draw (cave ventilation & server farm)"),

        _e("m2-05", "WayneTech Advanced Materials", "3600.00", "Shopping", _day(2, 5),
           is_major=True,
           description="Tactical-grade Kevlar jacket, ballistic prototype x4 — field test batch"),

        _e("m2-06", "ComfortCave Industries Ltd.", "144.00", "Shopping", _day(2, 6),
           description="Custom bat-motif briefs — 48-pack (comfort is non-negotiable)"),

        _e("m2-07", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(2, 9),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 2: trust issues, childhood trauma, unhealthy obsession with justice"),

        _e("m2-08", "Metropolis Geological Survey", "42000.00", "WayneTech R&D", _day(2, 10),
           is_major=True,
           description="Kryptonite sample Class-A 200g — research & containment (strictly precautionary)"),

        _e("m2-09", "The Blue Orchid, Nanda Parbat", "1240.00", "Dining", _day(2, 12),
           description="Business dinner with R. al Ghul — 'League networking'. Ordered the tasting menu."),

        _e("m2-10", "Gotham Opera House", "1800.00", "Entertainment", _day(2, 14),
           description="La Traviata — Box A (10 seats). Arrived via grappling hook, left via limousine."),

        _e("m2-11", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(2, 16),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 3: boundary-setting, identity concealment & its psychological cost"),

        _e("m2-12", "Two Sides Brasserie", "380.00", "Dining", _day(2, 18),
           description="Lunch with Harvey Dent — pre-acid incident. Split the bill 50/50."),

        _e("m2-13", "Anthropic (Claude Code)", "180.00", "Shopping", _day(2, 20),
           cadence="monthly", rg=_RG["claude"],
           description="Monthly AI assistant subscription — indispensable for cave ops planning"),

        _e("m2-14", "Gotham City Asylum Foundation", "50000.00", "Wayne Foundation", _day(2, 21),
           is_major=True, tx="debit",
           description="Annual charitable endowment — rehabilitation programmes fund"),

        _e("m2-15", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(2, 23),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 4: parental loss, long-term coping strategies (ongoing since age 8)"),

        _e("m2-16", "GothamAir Private Charter", "18500.00", "Travel", _day(2, 24),
           is_major=True,
           description="Gotham ↔ Nanda Parbat return — cargo hold includes 'sports equipment'"),

        _e("m2-17", "Billa Supermercato", "345.00", "Groceries", _day(2, 26),
           description="Alfred's weekly provisions — he insists on checking every label",
           items=_M2_GROCERY_ITEMS),

        _e("m2-18", "Wayne Foundation Events", "8800.00", "Entertainment", _day(2, 28),
           is_major=True,
           description="Annual Gala — 22 VIP tickets. Wore the tuxedo, not the other suit."),

        _e("m2-19", "WayneTech Manufacturing", "1600.00", "Crime Fighting", _day(2, 30),
           description="Batarang replenishment pack 200 units — monthly supply gone in 3 weeks (Gotham is busy)"),

        # Wayne Manor Ops ledger — month -2
        _e("l-manor-m2-01", "Whole Foods Market Gotham", "1800.00", "Groceries", _day(2, 8),
           ledger_id=ledger_manor, description="Wayne Manor monthly provisions — Alfred's bulk order"),
        _e("l-manor-m2-02", "Gotham Green Grounds Ltd.", "850.00", "Other", _day(2, 15),
           ledger_id=ledger_manor, description="Manor grounds bi-monthly maintenance & topiary"),

        # Fox-Wayne Labs ledger — month -2
        _e("l-fox-m2-01", "Gotham Advanced Composites Inc.", "12400.00", "WayneTech R&D", _day(2, 22),
           ledger_id=ledger_fox, is_major=True,
           description="Fox-Wayne Labs Q2 raw materials — carbon fiber, titanium alloy sheets"),

        # JL Petty Cash — month -2
        _e("l-jl-m2-01", "Gotham Roast Coffee", "145.00", "Dining", _day(2, 29),
           ledger_id=ledger_jl, description="JL HQ monthly coffee & snack fund. Aquaman drinks an unreasonable amount."),

        # ── Month -1 (last month) ────────────────────────────────────────────────

        _e("inc-m1-01", "Wayne Enterprises", "95000.00", "Salary", _day(1, 1), tx="credit",
           description="Monthly executive compensation — board-approved"),

        _e("m1-01", "Wayne Manor Estate Grid", "1840.00", "Bills", _day(1, 1),
           cadence="monthly", rg=_RG["manor_elec"],
           description="Wayne Manor electricity — previous billing cycle"),

        _e("m1-02", "Gotham Industrial Power Corp", "4100.00", "Bills", _day(1, 1),
           cadence="monthly", rg=_RG["cave_elec"],
           description="Sub-basement power draw — previous billing (the servers never sleep)"),

        _e("m1-03", "WayneTech BioLab", "8900.00", "Crime Fighting", _day(1, 3),
           is_major=True,
           description="Anti-Joker toxin research Phase II — synthesis & antidote stockpile"),

        _e("m1-04", "WayneTech Engineering", "2800.00", "Shopping", _day(1, 5),
           description="Grappling hook upgrade v4.0 — titanium core, 300m rated, silent deployment"),

        _e("m1-05", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(1, 6),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 5: processing the Ra's al Ghul dinner (again). Dr. Q seems concerned."),

        _e("m1-06", "Gotham Sports Medicine Clinic", "480.00", "Health", _day(1, 8),
           description="Sports physio — knee (recurring injury, cause of injury: classified)"),

        _e("m1-07", "WayneTech Special Projects", "29500.00", "WayneTech R&D", _day(1, 10),
           is_major=True,
           description="Kryptonite containment unit — Lucius Fox custom-spec, lead-lined with biometric lock"),

        _e("m1-08", "GothamAir Private Charter", "2400.00", "Travel", _day(1, 11),
           description="Gotham → Metropolis business class — JL Emergency Summit (not my idea)"),

        _e("m1-09", "The Diamond Restaurant", "940.00", "Dining", _day(1, 13),
           description="Dinner with Diana Prince — she ordered the entire seafood section. Respect."),

        _e("m1-10", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(1, 14),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 6: dinner with Diana (complicated), ongoing Ra's situation (very complicated)"),

        _e("m1-11", "Himalayan Botanicals Ltd.", "11200.00", "Shopping", _day(1, 15),
           is_major=True,
           description="Blue lotus flower seeds x500 — rare Nanda Parbat cultivar (research purposes ONLY)"),

        _e("m1-12", "Gotham Knights Sports Group", "3200.00", "Entertainment", _day(1, 17),
           description="VIP courtside box (16 seats) — Knights vs. Metropolis United. Clark was there. Awkward."),

        _e("m1-13", "ComfortCave Industries Ltd.", "72.00", "Shopping", _day(1, 18),
           description="Custom bat-motif briefs — 24-pack (half-order, trying to cut back)"),

        _e("m1-14", "Anthropic (Claude Code)", "180.00", "Shopping", _day(1, 19),
           cadence="monthly", rg=_RG["claude"],
           description="Monthly AI assistant — saved 3 hours of cave analysis this week"),

        _e("m1-15", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(1, 21),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 7: she asked why I keep attending Ra's dinners. I said networking."),

        _e("m1-16", "Gotham Children's Hospital", "75000.00", "Wayne Foundation", _day(1, 23),
           is_major=True,
           description="New cardiac unit sponsorship — anonymous donor (it's not anonymous)"),

        _e("m1-17", "Billa Supermercato", "412.00", "Groceries", _day(1, 25),
           description="Alfred's weekly provisions — he added salmon this month",
           items=_M1_GROCERY_ITEMS),

        _e("m1-18", "WayneTech Ordnance", "2100.00", "Crime Fighting", _day(1, 25),
           description="Explosive gel refill cartridges — batch order (Gotham especially busy)"),

        _e("m1-19", "WayneTech Materials Supply", "7200.00", "Shopping", _day(1, 27),
           is_major=True,
           description="Armored motorcycle jacket bulk order x12 — for the team (just Bruce)"),

        _e("m1-20", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(1, 28),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 8: blue flower seeds purchase flagged as 'concerning pattern'. Agreed to discuss."),

        _e("m1-21", "WayneTech Drone Division", "44000.00", "Crime Fighting", _day(1, 30),
           is_major=True,
           description="Gotham surveillance drone fleet x8 — silent rotors, 48h battery, Lucius-certified"),

        # Wayne Manor Ops ledger — month -1
        _e("l-manor-m1-01", "Whole Foods Market Gotham", "1920.00", "Groceries", _day(1, 6),
           ledger_id=ledger_manor, description="Wayne Manor monthly provisions"),
        _e("l-manor-m1-02", "CaveClean Industrial Services", "440.00", "Groceries", _day(1, 28),
           ledger_id=ledger_manor, description="Batcave deep-clean supplies — industrial-grade, bat-safe certified"),

        # Fox-Wayne Labs ledger — month -1
        _e("l-fox-m1-01", "CognitionTech Computing", "8900.00", "WayneTech R&D", _day(1, 16),
           ledger_id=ledger_fox, is_major=True,
           description="Batcomputer RAM expansion — Lucius Fox spec, 2PB upgrade"),

        # JL Petty Cash — month -1
        _e("l-jl-m1-01", "Gotham Pizza Palace", "280.00", "Dining", _day(1, 20),
           ledger_id=ledger_jl,
           description="JL meeting dinner — 4 large pizzas. Aquaman ate 6 slices. Arthur pays next time."),

        # ── Current month ────────────────────────────────────────────────────────

        _e("inc-m0-01", "Wayne Enterprises", "95000.00", "Salary", _day(0, 1), tx="credit",
           description="Monthly executive compensation — board-approved"),

        _e("m0-01", "Wayne Manor Estate Grid", "1840.00", "Bills", _day(0, 1),
           cadence="monthly", rg=_RG["manor_elec"],
           description="Wayne Manor electricity — previous billing cycle"),

        _e("m0-02", "Gotham Industrial Power Corp", "4100.00", "Bills", _day(0, 1),
           cadence="monthly", rg=_RG["cave_elec"],
           description="Sub-basement power draw — previous billing"),

        _e("m0-03", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(0, 2),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 9: the blue flower situation. She brought in a specialist colleague."),

        _e("m0-04", "WayneTech Engineering", "4800.00", "Shopping", _day(0, 3),
           description="Tactical utility belt prototype v7 — grappling hook, gel dispenser, 12 compartments"),

        _e("m0-05", "Caffè Romano, Gotham CBD", "280.00", "Dining", _day(0, 5),
           description="Business lunch with Clark Kent (Daily Planet) — he asked a lot of questions. Nice tie."),

        _e("m0-06", "Metropolis Advanced Materials", "68000.00", "WayneTech R&D", _day(0, 6),
           is_major=True,
           description="Kryptonite acquisition: 3 premium-grade specimens — green, red, gold variants (precautionary)"),

        _e("m0-07", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(0, 9),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 10: she asked why I now own Kryptonite in three colours. Still classified."),

        _e("m0-08", "al-Ghul Estate, Nanda Parbat", "880.00", "Dining", _day(0, 10),
           description="League of Shadows annual networking dinner — third year attending. Ra's is a good host."),

        _e("m0-09", "WayneTech Fuels Lab", "1240.00", "Crime Fighting", _day(0, 12),
           description="Batmobile premium synthetic fuel blend — 180L, high-octane, low thermal signature"),

        _e("m0-grocery", "Billa Supermercato", "296.00", "Groceries", _day(0, 12),
           description="Alfred's current-month provisions — the truffle was 'non-negotiable', apparently",
           items=_M0_GROCERY_ITEMS),

        _e("m0-10", "ComfortCave Industries Ltd.", "144.00", "Shopping", _day(0, 13),
           description="Custom bat-motif briefs — BACK TO 48-PACK. The half-order experiment failed."),

        _e("m0-11", "The Grand Ballroom, Gotham Plaza", "18500.00", "Entertainment", _day(0, 15),
           is_major=True,
           description="Wayne Enterprises Q2 Staff Summer Party — 340 attendees, open bar (Alfred supervised)"),

        _e("m0-12", "Dr. Harleen Quinzel, Psy.D.", "320.00", "Health", _day(0, 16),
           cadence="monthly", rg=_RG["therapy"],
           description="Session 11: staff party incident (joker-themed decoration — someone's fired). Bilateral trauma."),

        _e("m0-13", "Gotham Addiction Recovery Center", "100000.00", "Wayne Foundation", _day(0, 17),
           is_major=True,
           description="New wing naming rights + construction sponsorship — 'The Thomas & Martha Wayne Wing'"),

        _e("m0-14", "Anthropic (Claude Code)", "180.00", "Shopping", _day(0, 18),
           cadence="monthly", rg=_RG["claude"],
           description="Monthly AI assistant — used it to analyse Kryptonite acquisition ROI. Helpful."),

        _e("m0-15", "Gotham Sports Medicine Clinic", "750.00", "Health", _day(0, 19),
           description="Sports physio — knee (same knee). 'You really need to stop doing whatever you're doing.'"),

        _e("m0-16", "WayneTech Optics Division", "1800.00", "Crime Fighting", _day(0, 20),
           description="Night vision replacement unit x2, long-range — the gargoyle landing was a mistake"),

        # Wayne Manor Ops ledger — current month
        _e("l-manor-m0-01", "Whole Foods Market Gotham", "2100.00", "Groceries", _day(0, 14),
           ledger_id=ledger_manor, description="Wayne Manor monthly provisions — Alfred splurged on truffles"),

        # Fox-Wayne Labs ledger — current month
        _e("l-fox-m0-01", "SentinelTech Systems", "19500.00", "WayneTech R&D", _day(0, 8),
           ledger_id=ledger_fox, is_major=True,
           description="Fox-Wayne Labs — long-range thermal imaging prototype system v2"),

        # JL Petty Cash — current month
        _e("l-jl-m0-01", "Themyscira Premium Caterers", "1200.00", "Dining", _day(0, 11),
           ledger_id=ledger_jl,
           description="JL Summit catering — Diana's family catering company. Excellent, but NO seafood for Arthur."),
    ]


# ---------------------------------------------------------------------------
# Budget seed
# ---------------------------------------------------------------------------

def _build_budgets(cat_by_name: dict[str, uuid.UUID]) -> list[dict]:
    month = _month_start(0)
    return [
        {
            "id": _did("budget:crime-fighting"),
            "name": "Crime Fighting Equipment",
            "category_id": cat_by_name.get("Crime Fighting"),
            "amount": Decimal("5000.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "L. Fox insists on a budget. I insist on not following it.",
        },
        {
            "id": _did("budget:therapy"),
            "name": "Mandatory Therapy",
            "category_id": cat_by_name.get("Health"),
            "amount": Decimal("1500.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Agreed with Alfred. Non-negotiable.",
        },
        {
            "id": _did("budget:groceries"),
            "name": "Alfred's Grocery Allowance",
            "category_id": cat_by_name.get("Groceries"),
            "amount": Decimal("2000.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Alfred always comes in well under. He is disgracefully frugal for a man with access to a manor.",
        },
        {
            "id": _did("budget:rd"),
            "name": "WayneTech R&D (Definitely Not Kryptonite)",
            "category_id": cat_by_name.get("WayneTech R&D"),
            "amount": Decimal("10000.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Lucius asked me to put this budget in. I respect that. I do not respect the limit.",
        },
        {
            "id": _did("budget:bat-merch"),
            "name": "Bat-Branded Merchandise (Personal)",
            "category_id": None,
            "amount": Decimal("100.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Strictly personal. Alfred does not know about this line item.",
        },
    ]


# ---------------------------------------------------------------------------
# Peter Parker seed data
# ---------------------------------------------------------------------------

_PETER_RG = {
    "therapy": "peter:dr.madison.grief.therapy:EUR:debit:monthly:80.00",
    "rent": "peter:queens.apartment.rent:EUR:debit:monthly:850.00",
    "web_fluid": "peter:oscorp.web.fluid.polymer:EUR:debit:monthly:180.00",
    "metro": "peter:mta.monthly.card:EUR:debit:monthly:33.00",
}


def _build_peter_expenses(ledger_lab: uuid.UUID, ledger_avengers: uuid.UUID, ledger_may: uuid.UUID) -> list[dict]:
    return [

        # ── Month -2 ─────────────────────────────────────────────────────────────

        _e("p-inc-m2-01", "Daily Bugle Photography", "340.00", "Salary", _day(2, 1), tx="credit",
           description="J. Jonah Jameson's freelance check — docked €160 for 'Spider-Man photos not menacing enough'"),

        _e("p-inc-m2-02", "Empire State University", "280.00", "Salary", _day(2, 5), tx="credit",
           description="Chemistry TA stipend — grading papers on polymers I invented two years ago"),

        _e("p-m2-rent", "Queens Landlord LLC", "850.00", "Housing", _day(2, 2),
           cadence="monthly", rg=_PETER_RG["rent"],
           description="Monthly rent — Mrs Chen gave me an extension. She said 'you're a good boy, Peter'. I said nothing."),

        _e("p-m2-webfluid", "Oscorp Industrial Chemicals", "180.00", "Web Fluid R&D", _day(2, 3),
           cadence="monthly", rg=_PETER_RG["web_fluid"],
           description="Web fluid base polymer — monthly supply. Lab notebook reason: 'advanced thesis research on adhesives'"),

        _e("p-m2-therapy-01", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(2, 4),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 1: we started with Uncle Ben. We always start with Uncle Ben."),

        _e("p-m2-medical-01", "Queens Medical Center", "420.00", "Health", _day(2, 6),
           description="Rib fractures x2, dislocated shoulder — cause of injury entered as 'bicycle accident'. 4th visit this quarter."),

        _e("p-m2-suit-01", "Chinatown Fabric District", "34.00", "Crime Fighting", _day(2, 7),
           description="Red/blue spandex 3m + UV-resistant dye — told the cashier it was for a 'theatre project'"),

        _e("p-m2-ramen", "H-Mart Queens", "8.50", "Dining", _day(2, 8),
           description="Emergency ramen run — 3rd time this week. Ned says I should learn to cook. Ned is right."),

        _e("p-m2-camera", "B&H Photo Video NYC", "280.00", "Shopping", _day(2, 10),
           is_major=True,
           description="Nikon zoom lens — previous one destroyed in the Vulture incident. Expensed to Bugle as 'equipment wear'"),

        _e("p-m2-therapy-02", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(2, 12),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 2: still Uncle Ben. Briefly touched on Gwen. Dr. Madison suggested journaling. Will not journal."),

        _e("p-m2-cartridge", "Oscorp Advanced Materials", "320.00", "Web Fluid R&D", _day(2, 14),
           is_major=True,
           description="High-tensile web cartridges x12 — monthly supply. Told Ned they're '3D printing filament'. He knows."),

        _e("p-m2-chem-01", "Staten Island Chemical Co.", "95.00", "Web Fluid R&D", _day(2, 15),
           description="Tensile modifier compound — web strength upgrade. MJ noticed the chemicals. I said 'for school'."),

        _e("p-m2-backpack-01", "Target Queens", "28.00", "Shopping", _day(2, 16),
           description="Backpack #4 this year — previous ones: left on rooftop, caught fire, dissolved in acid (don't ask)"),

        _e("p-m2-therapy-03", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(2, 18),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 3: lighter session! We discussed compartmentalization. Very relevant to my situation."),

        _e("p-m2-book", "ESU Campus Bookstore", "74.00", "Shopping", _day(2, 19),
           description="Advanced Organic Chemistry vol. 4 — for class AND for other reasons I will not specify here"),

        _e("p-m2-mj-01", "Delmar's Deli-Grocery", "22.00", "Dining", _day(2, 20),
           description="Dinner with MJ — she had the salmon; I had the #3 combo. She tried to pay. I declined. Error."),

        _e("p-m2-grocery", "Walmart Supercenter Queens", "52.00", "Groceries", _day(2, 22),
           description="Monthly provisions — ramen x24, PB&J supplies. Aunt May would not approve of this diet.",
           items=_M2_PETER_GROCERY_ITEMS),

        _e("p-m2-therapy-04", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(2, 25),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 4: discussed masks — metaphor and literal. She doesn't know it's both."),

        _e("p-m2-metro", "MTA New York City Transit", "33.00", "Transport", _day(2, 26),
           cadence="monthly", rg=_PETER_RG["metro"],
           description="Monthly MetroCard — backup transport for when the suit is being repaired by Ned"),

        _e("p-m2-medical-02", "Queens Medical Center", "140.00", "Health", _day(2, 28),
           description="Rib follow-up. Doctor notes I'm healing 'unusually fast'. I said: good metabolism. He: noted it."),

        # Parker Lab ledger — month -2
        _e("p-l-lab-m2-01", "Carolina Biological Supply", "145.00", "Web Fluid R&D", _day(2, 11),
           ledger_id=ledger_lab,
           description="Lab supplies (Ned's order) — listed as 'ESU adhesion research project'. That's not what we call it."),

        # Avengers — month -2
        _e("p-l-avg-m2-01", "Avengers Compound Cafeteria", "8.50", "Dining", _day(2, 19),
           ledger_id=ledger_avengers,
           description="Lunch at the compound — I was invited. This is not a drill. Turkey sandwich. Very good."),

        # Aunt May ledger — month -2
        _e("p-l-may-m2-01", "Walgreens Queens", "34.00", "Health", _day(2, 17),
           ledger_id=ledger_may,
           description="Aunt May's prescriptions + vitamins — she doesn't ask where I find the money. I appreciate that."),

        # ── Month -1 ─────────────────────────────────────────────────────────────

        _e("p-inc-m1-01", "Daily Bugle Photography", "480.00", "Salary", _day(1, 1), tx="credit",
           description="Best Bugle check in months — Jameson said 'barely adequate'. Framed it on the wall."),

        _e("p-inc-m1-02", "Stark Industries", "500.00", "Salary", _day(1, 3), tx="credit",
           description="Consulting fee from Happy Hogan — Tony called it 'educational expenses'. I'll take it."),

        _e("p-m1-rent", "Queens Landlord LLC", "850.00", "Housing", _day(1, 2),
           cadence="monthly", rg=_PETER_RG["rent"],
           description="Monthly rent — paid ON TIME for once. Mrs Chen nearly fainted."),

        _e("p-m1-webfluid", "Oscorp Industrial Chemicals", "180.00", "Web Fluid R&D", _day(1, 3),
           cadence="monthly", rg=_PETER_RG["web_fluid"],
           description="Web fluid monthly order — formula still the best I've designed. Ned wanted to add glitter. No."),

        _e("p-m1-therapy-01", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(1, 5),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 5: we made it 15 full minutes before Uncle Ben came up. Personal record."),

        _e("p-m1-medical-01", "Bellevue Hospital Center", "650.00", "Health", _day(1, 7),
           is_major=True,
           description="Concussion + fractured wrist — 'bicycle accident'. Doctor said 'see you next month'. Accurate prediction."),

        _e("p-m1-suit-01", "AliExpress", "18.00", "Crime Fighting", _day(1, 8),
           description="Replacement eye lenses for mask — €18 + 3 weeks shipping. Ned suggested Prime. He's right."),

        _e("p-m1-cartridge", "Oscorp Advanced Materials", "320.00", "Web Fluid R&D", _day(1, 10),
           is_major=True,
           description="Web cartridges x12 — went through them fast. Rhino was involved. Long story, much webbing."),

        _e("p-m1-camera", "B&H Photo Video NYC", "190.00", "Shopping", _day(1, 12),
           description="Camera mount + remote trigger — for 'self-portraits'. Bugle pays better for action shots."),

        _e("p-m1-therapy-02", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(1, 14),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 6: discussed whether wearing a mask all day is authentic self-expression. It is not."),

        _e("p-m1-grocery", "Walmart Supercenter Queens", "57.00", "Groceries", _day(1, 16),
           description="Monthly grocery run — splurged on NAME-BRAND peanut butter. Stark stipend month. No regrets.",
           items=_M1_PETER_GROCERY_ITEMS),

        _e("p-m1-chem-01", "Fisher Scientific", "145.00", "Web Fluid R&D", _day(1, 18),
           description="Micro-filament spooler + precision nozzle tips — 'for the lab'. For THE lab."),

        _e("p-m1-therapy-03", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(1, 20),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 7: discussed power and responsibility. I changed the subject. She noticed immediately."),

        _e("p-m1-mj-01", "Joe Coffee Midtown", "14.00", "Dining", _day(1, 21),
           description="Coffee with MJ — she's writing on vigilantes. I pretended to find it purely hypothetical."),

        _e("p-m1-backpack-01", "Target Queens", "28.00", "Shopping", _day(1, 22),
           description="Backpack #2 this month — last one lasted 11 days before the Electro incident"),

        _e("p-m1-therapy-04", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(1, 24),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 8: she asked if the 'mystery friend' I mentioned has my back. Yes. Sort of. It's complicated."),

        _e("p-m1-metro", "MTA New York City Transit", "33.00", "Transport", _day(1, 25),
           cadence="monthly", rg=_PETER_RG["metro"],
           description="Monthly MetroCard — Happy asked why I still need this. 'Dates,' I said. Partially true."),

        _e("p-m1-suit-repair", "Chinatown Fabric District", "45.00", "Crime Fighting", _day(1, 27),
           description="Suit patching + Kevlar reinforcement — Rhino tears. Ned is doing the stitching now. He's better at it."),

        _e("p-m1-tuition", "Empire State University", "380.00", "Shopping", _day(1, 28),
           is_major=True,
           description="Monthly tuition installment — scholarship covers 70%. The other 30% covers the anxiety too."),

        # Parker Lab ledger — month -1
        _e("p-l-lab-m1-01", "Sigma-Aldrich", "220.00", "Web Fluid R&D", _day(1, 13),
           ledger_id=ledger_lab, is_major=True,
           description="Polymer synthesis kit — Ned found a deal. The deal was: experimental and possibly not legal in 3 states."),

        # Avengers — month -1
        _e("p-l-avg-m1-01", "Avengers Compound Gift Shop", "24.00", "Shopping", _day(1, 15),
           ledger_id=ledger_avengers,
           description="Bought Aunt May a 'Stark Industries' mug from the gift shop. Did not tell her where I was."),

        # Aunt May ledger — month -1
        _e("p-l-may-m1-01", "Key Food Supermarkets", "78.00", "Groceries", _day(1, 20),
           ledger_id=ledger_may,
           description="May's weekly shop — she cooks for me every Sunday. Roast chicken. This is the least I can do."),

        # ── Current month ─────────────────────────────────────────────────────────

        _e("p-inc-m0-01", "Daily Bugle Photography", "410.00", "Salary", _day(0, 1), tx="credit",
           description="This month's Bugle check — Jameson said my Spider-Man photos 'show his criminal nature'. Framing #2."),

        _e("p-m0-rent", "Queens Landlord LLC", "850.00", "Housing", _day(0, 2),
           cadence="monthly", rg=_PETER_RG["rent"],
           description="Monthly rent — autopay set up. Small victory in an otherwise chaotic life."),

        _e("p-m0-webfluid", "Oscorp Industrial Chemicals", "180.00", "Web Fluid R&D", _day(0, 3),
           cadence="monthly", rg=_PETER_RG["web_fluid"],
           description="Web fluid supply — reformulated adhesion coefficient. Ned: 'impressive'. MJ: 'why is there webbing in the sink'."),

        _e("p-m0-therapy-01", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(0, 4),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 9: 40 full minutes, no Uncle Ben. Dr. Madison cried. (So did I, later, in the stairwell.)"),

        _e("p-m0-cartridge", "Oscorp Advanced Materials", "320.00", "Web Fluid R&D", _day(0, 6),
           is_major=True,
           description="Web cartridges x12 — ran out in 3 weeks. Sandman is very, very wasteful of webbing."),

        _e("p-m0-chem-01", "Staten Island Chemical Co.", "115.00", "Web Fluid R&D", _day(0, 8),
           description="Polymer catalyst batch — new synthesis. Lab note: DO NOT TOUCH THE BLUE ONE (lab incident, don't ask)"),

        _e("p-m0-therapy-02", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(0, 9),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 10: relapse — talked about Uncle Ben for 55 of 60 minutes. Dr. Madison: visibly tired."),

        _e("p-m0-medical", "Queens Medical Center", "290.00", "Health", _day(0, 11),
           description="Sprained ankle, bruised sternum — 'same bicycle, same exact accident'. They have a dedicated file now."),

        _e("p-m0-grocery", "Walmart Supercenter Queens", "44.00", "Groceries", _day(0, 12),
           description="Monthly grocery — ramen x20, bread, PB, Gatorade x6. Aunt May would not approve. She'd be right.",
           items=_M0_PETER_GROCERY_ITEMS),

        _e("p-m0-mj-01", "Patsy's Pizzeria Queens", "28.00", "Dining", _day(0, 13),
           description="Pizza with MJ — her idea, my bill. She had 4 slices. I respect that. I had 2. Shame."),

        _e("p-m0-suit-01", "Amazon.com", "52.00", "Crime Fighting", _day(0, 14),
           description="Carbon fibre reinforcement fabric + heat-resistant thread — suit v3.4 upgrade. Ned: 'This one will hold?' Maybe."),

        _e("p-m0-therapy-03", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(0, 16),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 11: breakthrough — 25 minutes no Uncle Ben. Then I mentioned the radioactive spider. Back to zero."),

        _e("p-m0-metro", "MTA New York City Transit", "33.00", "Transport", _day(0, 17),
           cadence="monthly", rg=_PETER_RG["metro"],
           description="Monthly MetroCard — Ned asked why I still buy this. 'For dates,' I said. Partially true."),

        _e("p-m0-backpack-01", "Duane Reade", "19.00", "Shopping", _day(0, 18),
           description="Backpack from the clearance bin — €19. Mr Stark would be embarrassed. He never said that but I know."),

        _e("p-m0-therapy-04", "Dr. Marla Madison, LCSW", "80.00", "Health", _day(0, 19),
           cadence="monthly", rg=_PETER_RG["therapy"],
           description="Session 12: discussed responsibility. She still doesn't know. I think that's the whole point."),

        _e("p-m0-tuition", "Empire State University", "380.00", "Shopping", _day(0, 20),
           is_major=True,
           description="Tuition installment — Professor Connors wrote a glowing recommendation. He then became a lizard."),

        # Parker Lab ledger — current month
        _e("p-l-lab-m0-01", "LabSupply Direct", "95.00", "Web Fluid R&D", _day(0, 7),
           ledger_id=ledger_lab,
           description="Micro-dispensing nozzles x20 — web cartridge refill components. Ned: 'this is genuinely so cool'"),

        # Avengers — current month
        _e("p-l-avg-m0-01", "Shake Shack Midtown", "12.50", "Dining", _day(0, 9),
           ledger_id=ledger_avengers,
           description="Lunch near the compound — Happy invited. I paid my own shake out of pride. Happy didn't notice."),

        # Aunt May ledger — current month
        _e("p-l-may-m0-01", "Walgreens Queens", "34.00", "Health", _day(0, 10),
           ledger_id=ledger_may,
           description="May's prescriptions — she asked why I look bruised. I said 'gym'. She said 'sure'. She knows."),
    ]


def _build_peter_budgets(cat_by_name: dict[str, uuid.UUID]) -> list[dict]:
    month = _month_start(0)
    return [
        {
            "id": _did("p-budget:rent"),
            "name": "Rent (Absolutely Non-Negotiable)",
            "category_id": cat_by_name.get("Housing"),
            "amount": Decimal("850.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Exactly €850. Mrs Chen has been very patient. This one does not slip.",
        },
        {
            "id": _did("p-budget:web-rd"),
            "name": "Web Fluid R&D (Officially: Chemistry Thesis)",
            "category_id": cat_by_name.get("Web Fluid R&D"),
            "amount": Decimal("100.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Budget suggested by Ned. Actual spend: 5-6x over every month. I have expensive hobbies.",
        },
        {
            "id": _did("p-budget:groceries"),
            "name": "Groceries (Being Very Optimistic)",
            "category_id": cat_by_name.get("Groceries"),
            "amount": Decimal("60.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Ramen is €0.35 a pack. I am ironically very good at this one.",
        },
        {
            "id": _did("p-budget:crime"),
            "name": "Crime Fighting Equipment (Classified Budget)",
            "category_id": cat_by_name.get("Crime Fighting"),
            "amount": Decimal("50.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "Ned suggested €50. We both knew this was aspirational. Current month: already €52 on Amazon alone.",
        },
        {
            "id": _did("p-budget:mj"),
            "name": "MJ — Dates & Coffee",
            "category_id": None,
            "amount": Decimal("40.00"),
            "currency": "EUR",
            "period": "monthly",
            "month_start": month,
            "notes": "She insists on splitting. I insist on paying. She wins most of the time. Honestly great for the budget.",
        },
    ]


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

async def _get_or_create_user(
    db: AsyncSession,
    user_id: uuid.UUID,
    email: str,
    name: str,
    avatar_url: str,
) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(id=user_id, email=email, name=name, avatar_url=avatar_url, status="approved")
        db.add(user)
    else:
        # Always sync the avatar so existing rows get updated when the seed changes.
        user.avatar_url = avatar_url
    await db.flush()
    return user


async def _get_categories(db: AsyncSession, user_id: uuid.UUID) -> dict[str, uuid.UUID]:
    """Return {category_name: category_id} for a given user."""
    result = await db.execute(select(Category.name, Category.id).where(Category.user_id == user_id))
    return {row[0]: row[1] for row in result.all()}


async def _ensure_custom_categories(
    db: AsyncSession,
    user_id: uuid.UUID,
    cat_by_name: dict[str, uuid.UUID],
    custom_cats: list[tuple[str, str, str, str]],
) -> None:
    for name, color, icon, tx_type in custom_cats:
        if name.lower() not in {k.lower() for k in cat_by_name}:
            db.add(Category(user_id=user_id, name=name, color=color, icon=icon, transaction_type=tx_type, is_system=False))
    await db.flush()


async def _ensure_partner_requests(
    db: AsyncSession,
    bruce_id: uuid.UUID,
    partners: list[tuple[uuid.UUID, str]],
) -> None:
    for partner_id, partner_email in partners:
        result = await db.execute(
            select(PartnerRequest).where(
                PartnerRequest.requester_id == bruce_id,
                PartnerRequest.recipient_id == partner_id,
            )
        )
        if result.scalar_one_or_none() is None:
            db.add(PartnerRequest(
                id=_did(f"partner:{bruce_id}:{partner_id}"),
                requester_id=bruce_id,
                recipient_email=partner_email,
                recipient_id=partner_id,
                status="accepted",
            ))
    await db.flush()


async def _create_ledger(
    db: AsyncSession,
    ledger_id: uuid.UUID,
    name: str,
    owner_id: uuid.UUID,
    member_ids: list[uuid.UUID],
) -> Ledger:
    ledger = Ledger(id=ledger_id, name=name, type="shared", created_by=owner_id)
    db.add(ledger)
    await db.flush()
    db.add(LedgerMembership(ledger_id=ledger_id, user_id=owner_id, role="owner"))
    for mid in member_ids:
        db.add(LedgerMembership(ledger_id=ledger_id, user_id=mid, role="editor"))
    await db.flush()
    return ledger


async def _seed_expenses_and_budgets(
    db: AsyncSession,
    user_id: uuid.UUID,
    cat_by_name: dict[str, uuid.UUID],
    ledger_manor: uuid.UUID,
    ledger_fox: uuid.UUID,
    ledger_jl: uuid.UUID,
) -> None:
    rows = _build_expenses(ledger_manor, ledger_fox, ledger_jl)
    for row in rows:
        cat_id = cat_by_name.get(row["cat_name"])
        expense = Expense(
            id=row["id"],
            user_id=user_id,
            category_id=cat_id,
            merchant=row["merchant"],
            amount=row["amount"],
            transaction_type=row["transaction_type"],
            currency=row["currency"],
            expense_date=row["expense_date"],
            source="manual",
            confidence=1.0,
            needs_review=False,
            cadence=row["cadence"],
            is_recurring=row["is_recurring"],
            recurring_group=row["recurring_group"],
            recurring_auto_add=False,
            is_major_purchase=row["is_major_purchase"],
            notes=row["notes"],
            description=row["description"],
            ledger_id=row["ledger_id"],
        )
        db.add(expense)
        await db.flush()

        for item in row["items"]:
            db.add(ExpenseItem(
                expense_id=expense.id,
                description=item["description"],
                quantity=item.get("quantity"),
                unit_price=Decimal(str(item["unit_price"])) if item.get("unit_price") else None,
                total_price=Decimal(str(item["total"])),
                subcategory=item.get("subcategory"),
                subcategory_confidence=item.get("subcategory_confidence"),
            ))

    budgets = _build_budgets(cat_by_name)
    for b in budgets:
        db.add(Budget(
            id=b["id"],
            user_id=user_id,
            name=b["name"],
            category_id=b["category_id"],
            amount=b["amount"],
            currency=b["currency"],
            period=b["period"],
            month_start=b["month_start"],
            notes=b["notes"],
        ))
    await db.flush()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def seed_demo_data(db: AsyncSession) -> User:
    """Create Bruce Wayne, partner stubs, categories, and all seed data.

    Idempotent: safe to call multiple times — will not duplicate data.
    """
    # Stub partner accounts
    await _get_or_create_user(db, ALFRED_ID, "alfred.pennyworth@waynemanor.com", "Alfred Pennyworth",
                              _avatar_svg("AP", "#1a1a2e", "#d4af37"))
    await _get_or_create_user(db, LUCIUS_ID, "lucius.fox@wayneenterprises.com", "Lucius Fox",
                              _avatar_svg("LF", "#1e3a5f", "#60a5fa"))
    await _get_or_create_user(db, CLARK_ID, "clark.kent@dailyplanet.com", "Clark Kent",
                              _avatar_svg("CK", "#1e293b", "#ef4444"))

    # Bruce Wayne
    bruce = await _get_or_create_user(
        db, BRUCE_WAYNE_ID, DEMO_USER_EMAIL, "Bruce Wayne",
        _avatar_svg("BW", "#0d1117", "#fbbf24"),
    )

    # Categories
    await ensure_default_categories(db, bruce.id)
    cat_by_name = await _get_categories(db, bruce.id)
    await _ensure_custom_categories(db, bruce.id, cat_by_name, _BRUCE_CUSTOM_CATS)
    await db.commit()
    cat_by_name = await _get_categories(db, bruce.id)

    # Partner links (shown on account page)
    await _ensure_partner_requests(db, bruce.id, [
        (ALFRED_ID, "alfred.pennyworth@waynemanor.com"),
        (LUCIUS_ID, "lucius.fox@wayneenterprises.com"),
        (CLARK_ID, "clark.kent@dailyplanet.com"),
    ])

    # Seed if empty, or if the current month's grocery (a reliable canary) is missing —
    # which happens when new seed code is deployed but the beat reset hasn't fired yet.
    needs_seed = False
    count_result = await db.execute(select(func.count(Expense.id)).where(Expense.user_id == bruce.id))
    if (count_result.scalar() or 0) == 0:
        needs_seed = True
    else:
        canary_id = _did("m0-grocery")
        canary = await db.execute(
            select(func.count(Expense.id)).where(
                Expense.id == canary_id,
                Expense.expense_date >= _month_start(0),
            )
        )
        if (canary.scalar() or 0) == 0:
            needs_seed = True
    if needs_seed:
        await reset_demo_data(db, bruce.id, cat_by_name)

    await db.commit()
    return bruce


async def reset_demo_data(db: AsyncSession, user_id: uuid.UUID | None = None, cat_by_name: dict[str, uuid.UUID] | None = None) -> None:
    """Wipe and re-seed all ephemeral data for Bruce Wayne.

    Called by the Celery beat task every 30 minutes and on first login when
    no expenses exist yet.
    """
    uid = user_id or BRUCE_WAYNE_ID

    # 1. Expenses (cascade deletes ExpenseItems via FK)
    await db.execute(delete(Expense).where(Expense.user_id == uid))
    # 2. Budgets
    await db.execute(delete(Budget).where(Budget.user_id == uid))
    # 3. Ledgers — cascade kills LedgerMembership + LedgerAuditLog
    await db.execute(delete(Ledger).where(Ledger.created_by == uid))
    # 4. Chat sessions — cascade kills ChatMessages
    await db.execute(delete(ChatSession).where(ChatSession.user_id == uid))
    await db.flush()

    # Re-fetch categories if not provided
    if cat_by_name is None:
        cat_by_name = await _get_categories(db, uid)

    # Re-create shared ledgers
    ledger_manor = await _create_ledger(db, _LEDGER_MANOR_ID, "Wayne Manor Ops", uid, [ALFRED_ID])
    ledger_fox = await _create_ledger(db, _LEDGER_FOX_ID, "Fox-Wayne Labs", uid, [LUCIUS_ID])
    ledger_jl = await _create_ledger(db, _LEDGER_JL_ID, "JL Petty Cash", uid, [CLARK_ID])

    await _seed_expenses_and_budgets(db, uid, cat_by_name, ledger_manor.id, ledger_fox.id, ledger_jl.id)
    await db.commit()
    await invalidate_analytics_cache(uid)
    logger.info("demo.reset_complete", user_id=str(uid))


async def seed_peter_data(db: AsyncSession) -> User:
    """Create Peter Parker, partner stubs, categories, and all seed data.

    Idempotent: safe to call multiple times — will not duplicate data.
    """
    await _get_or_create_user(db, MJ_ID, "mj.watson@empire-state.edu", "Mary Jane Watson",
                              _avatar_svg("MJ", "#7f1d1d", "#fca5a5"))
    await _get_or_create_user(db, NED_ID, "ned.leeds@empire-state.edu", "Ned Leeds",
                              _avatar_svg("NL", "#1e3a5f", "#93c5fd"))
    await _get_or_create_user(db, AUNT_MAY_ID, "may.parker@queens.ny.us", "May Parker",
                              _avatar_svg("MP", "#3b1f5c", "#c084fc"))
    await _get_or_create_user(db, HAPPY_ID, "happy.hogan@starkindustries.com", "Happy Hogan",
                              _avatar_svg("HH", "#1c1917", "#fb923c"))

    peter = await _get_or_create_user(
        db, PETER_PARKER_ID, PETER_PARKER_EMAIL, "Peter Parker",
        _avatar_svg("PP", "#1e1b4b", "#f87171"),
    )

    await ensure_default_categories(db, peter.id)
    cat_by_name = await _get_categories(db, peter.id)
    await _ensure_custom_categories(db, peter.id, cat_by_name, _PETER_CUSTOM_CATS)
    await db.commit()
    cat_by_name = await _get_categories(db, peter.id)

    await _ensure_partner_requests(db, peter.id, [
        (MJ_ID, "mj.watson@empire-state.edu"),
        (NED_ID, "ned.leeds@empire-state.edu"),
        (AUNT_MAY_ID, "may.parker@queens.ny.us"),
        (HAPPY_ID, "happy.hogan@starkindustries.com"),
    ])

    needs_seed = False
    count_result = await db.execute(select(func.count(Expense.id)).where(Expense.user_id == peter.id))
    if (count_result.scalar() or 0) == 0:
        needs_seed = True
    else:
        canary_id = _did("p-m0-grocery")
        canary = await db.execute(
            select(func.count(Expense.id)).where(
                Expense.id == canary_id,
                Expense.expense_date >= _month_start(0),
            )
        )
        if (canary.scalar() or 0) == 0:
            needs_seed = True
    if needs_seed:
        await reset_peter_data(db, peter.id, cat_by_name)

    await db.commit()
    return peter


async def reset_peter_data(db: AsyncSession, user_id: uuid.UUID | None = None, cat_by_name: dict[str, uuid.UUID] | None = None) -> None:
    """Wipe and re-seed all ephemeral data for Peter Parker."""
    uid = user_id or PETER_PARKER_ID

    await db.execute(delete(Expense).where(Expense.user_id == uid))
    await db.execute(delete(Budget).where(Budget.user_id == uid))
    await db.execute(delete(Ledger).where(Ledger.created_by == uid))
    await db.execute(delete(ChatSession).where(ChatSession.user_id == uid))
    await db.flush()

    if cat_by_name is None:
        cat_by_name = await _get_categories(db, uid)

    ledger_lab = await _create_ledger(db, _LEDGER_PARKER_LAB_ID, "Parker's Lab", uid, [NED_ID])
    ledger_avengers = await _create_ledger(db, _LEDGER_AVENGERS_ID, "Avengers Auxiliary", uid, [HAPPY_ID])
    ledger_may = await _create_ledger(db, _LEDGER_MAY_ID, "Aunt May's Household", uid, [AUNT_MAY_ID])

    rows = _build_peter_expenses(ledger_lab.id, ledger_avengers.id, ledger_may.id)
    for row in rows:
        cat_id = cat_by_name.get(row["cat_name"])
        expense = Expense(
            id=row["id"],
            user_id=uid,
            category_id=cat_id,
            merchant=row["merchant"],
            amount=row["amount"],
            transaction_type=row["transaction_type"],
            currency=row["currency"],
            expense_date=row["expense_date"],
            source="manual",
            confidence=1.0,
            needs_review=False,
            cadence=row["cadence"],
            is_recurring=row["is_recurring"],
            recurring_group=row["recurring_group"],
            recurring_auto_add=False,
            is_major_purchase=row["is_major_purchase"],
            notes=row["notes"],
            description=row["description"],
            ledger_id=row["ledger_id"],
        )
        db.add(expense)
        await db.flush()
        for item in row["items"]:
            db.add(ExpenseItem(
                expense_id=expense.id,
                description=item["description"],
                quantity=item.get("quantity"),
                unit_price=Decimal(str(item["unit_price"])) if item.get("unit_price") else None,
                total_price=Decimal(str(item["total"])),
                subcategory=item.get("subcategory"),
                subcategory_confidence=item.get("subcategory_confidence"),
            ))

    budgets = _build_peter_budgets(cat_by_name)
    for b in budgets:
        db.add(Budget(
            id=b["id"],
            user_id=uid,
            name=b["name"],
            category_id=b["category_id"],
            amount=b["amount"],
            currency=b["currency"],
            period=b["period"],
            month_start=b["month_start"],
            notes=b["notes"],
        ))
    await db.flush()
    await db.commit()
    await invalidate_analytics_cache(uid)
    logger.info("demo.peter_reset_complete", user_id=str(uid))


async def reset_all_demo_data(db: AsyncSession) -> None:
    """Reset both Bruce Wayne and Peter Parker in one Celery task invocation."""
    await reset_demo_data(db)
    await reset_peter_data(db)
