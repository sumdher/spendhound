"""Core domain helpers for SpendHound."""

from __future__ import annotations

import calendar
from difflib import SequenceMatcher
import re
import unicodedata
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

import structlog
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from app.config import settings
from app.models.budget import Budget
from app.models.category import Category, ItemKeywordRule, MerchantRule
from app.models.expense import Expense
from app.models.expense_item import ExpenseItem
from app.models.receipt import Receipt

logger = structlog.get_logger(__name__)

TRANSACTION_TYPE_DEBIT = "debit"
TRANSACTION_TYPE_CREDIT = "credit"

CADENCE_ONE_TIME = "one_time"
CADENCE_MONTHLY = "monthly"
CADENCE_YEARLY = "yearly"
CADENCE_CUSTOM = "custom"    # every N months, interval stored in cadence_interval
CADENCE_PREPAID = "prepaid"  # single lump-sum payment covering N months

DEFAULT_CATEGORIES: list[tuple[str, str, str, str]] = [
    ("Groceries", "#34d399", "shopping-cart", TRANSACTION_TYPE_DEBIT),
    ("Dining", "#f59e0b", "utensils-crossed", TRANSACTION_TYPE_DEBIT),
    ("Transport", "#60a5fa", "car", TRANSACTION_TYPE_DEBIT),
    ("Bills", "#f87171", "receipt-text", TRANSACTION_TYPE_DEBIT),
    ("Housing", "#a78bfa", "home", TRANSACTION_TYPE_DEBIT),
    ("Health", "#fb7185", "heart-pulse", TRANSACTION_TYPE_DEBIT),
    ("Entertainment", "#f472b6", "film", TRANSACTION_TYPE_DEBIT),
    ("Shopping", "#22c55e", "store", TRANSACTION_TYPE_DEBIT),
    ("Travel", "#38bdf8", "plane", TRANSACTION_TYPE_DEBIT),
    ("Other", "#94a3b8", "circle-help", TRANSACTION_TYPE_DEBIT),
    ("Salary", "#10b981", "badge-euro", TRANSACTION_TYPE_CREDIT),
    ("Gift", "#ec4899", "gift", TRANSACTION_TYPE_CREDIT),
    ("Refund", "#22c55e", "rotate-ccw", TRANSACTION_TYPE_CREDIT),
    ("Reimbursement", "#14b8a6", "wallet", TRANSACTION_TYPE_CREDIT),
    ("Transfer", "#6366f1", "arrow-right-left", TRANSACTION_TYPE_CREDIT),
    ("Interest", "#06b6d4", "landmark", TRANSACTION_TYPE_CREDIT),
    ("Other Income", "#84cc16", "circle-dollar-sign", TRANSACTION_TYPE_CREDIT),
]

GROCERY_SUBCATEGORY_RULES: list[tuple[re.Pattern[str], str]] = [
    # Vegetables — EN + IT
    (re.compile(
        r"\b(lettuce|tomato|tomatoes|spinach|potato|potatoes|onion|onions|broccoli|carrot|carrots|"
        r"pepper|peppers|cucumber|cucumbers|zucchini|mushroom|mushrooms|salad|vegetable|vegetables|veg|"
        r"pomodoro|pomodori|pomodorino|pomodorini|spinaci|patata|patate|cipolla|cipolle|carota|carote|"
        r"peperone|peperoni|cetriolo|cetrioli|zucchina|zucchine|fungo|funghi|insalata|verdura|verdure|"
        r"aglio|finocchio|finocchi|melanzana|melanzane|carciofo|carciofi|cavolo|cavoli|"
        r"asparago|asparagi|fagiolino|fagiolini|pisello|piselli|mais|radicchio|sedano|rucola|porro|porri|"
        r"cipollotto|broccolo|cavolfiore|zucca|fagiolini)\b",
        re.IGNORECASE,
    ), "Vegetables"),

    # Fruit — EN + IT
    (re.compile(
        r"\b(apple|apples|banana|bananas|orange|oranges|lemon|lemons|lime|limes|"
        r"berry|berries|grape|grapes|melon|melons|pear|pears|peach|peaches|"
        r"kiwi|kiwis|mango|mangoes|avocado|avocados|fruit|"
        r"mela|mele|banane|arancia|arance|limone|limoni|fragola|fragole|uva|"
        r"melone|meloni|pera|pere|pesca|pesche|frutta|ananas|ciliegia|ciliegie|"
        r"albicocca|albicocche|prugna|prugne|fico|fichi|pompelmo|mandarino|mandarini|"
        r"clementina|clementine|mora|more|lampone|lamponi|mirtillo|mirtilli)\b",
        re.IGNORECASE,
    ), "Fruit"),

    # Meat — EN + IT
    (re.compile(
        r"\b(chicken|beef|pork|turkey|sausage|bacon|mince|steak|ham|meat|"
        r"pollo|manzo|maiale|tacchino|salsiccia|salsicce|pancetta|bistecca|prosciutto|carne|"
        r"vitello|agnello|salame|mortadella|bresaola|speck|wurstel|cotoletta|cotolette|"
        r"arrosto|fettina|fettine|braciola|braciole|hamburger|polpetta|polpette|affettato|affettati)\b",
        re.IGNORECASE,
    ), "Meat"),

    # Fish & Seafood — EN + IT
    (re.compile(
        r"\b(salmon|tuna|cod|shrimp|prawn|mussel|mussels|fish|seafood|"
        r"salmone|tonno|merluzzo|gambero|gamberetti|gamberi|cozza|cozze|pesce|"
        r"acciuga|acciughe|sardina|sardine|trota|branzino|orata|vongola|vongole|"
        r"calamaro|calamari|polpo|baccala|dentice|sgombro|rombo|spigola)\b",
        re.IGNORECASE,
    ), "Fish & Seafood"),

    # Dairy & Eggs — EN + IT
    (re.compile(
        r"\b(milk|yogurt|cheese|butter|cream|mozzarella|parmesan|egg|eggs|"
        r"latte|formaggio|formaggi|burro|panna|parmigiano|grana|uova|uovo|ricotta|"
        r"gorgonzola|pecorino|mascarpone|scamorza|stracchino|taleggio|kefir|"
        r"brie|feta|fontina|provolone|asiago|emmental|caciotta|crescenza)\b",
        re.IGNORECASE,
    ), "Dairy & Eggs"),

    # Bakery — EN + IT
    (re.compile(
        r"\b(bread|bagel|croissant|bun|roll|baguette|cake|muffin|bakery|pastry|tortilla|"
        r"pane|cornetto|brioche|focaccia|ciabatta|grissini|panino|panini|"
        r"schiacciata|tramezzino|filone|michetta|sfilatino|biscottate)\b",
        re.IGNORECASE,
    ), "Bakery"),

    # Frozen — EN + IT
    (re.compile(
        r"\b(frozen|ice cream|gelato|pizza|fries|fish fingers|"
        r"surgelato|surgelati|ghiacciolo|gelati)\b",
        re.IGNORECASE,
    ), "Frozen"),

    # Snacks — EN + IT
    (re.compile(
        r"\b(chips|crisps|cracker|crackers|chocolate|cookie|cookies|biscuit|biscuits|"
        r"snack|snacks|candy|popcorn|nuts|trail mix|"
        r"patatine|cioccolato|biscotto|biscotti|caramella|caramelle|"
        r"noccioline|noci|mandorle|arachidi|pistacchi|wafer|merendina|merendine|confetti)\b",
        re.IGNORECASE,
    ), "Snacks"),

    # Beverages — EN + IT
    (re.compile(
        r"\b(water|juice|cola|soda|sparkling|coffee|tea|beer|wine|drink|beverage|"
        r"acqua|succo|bibita|bibite|gassata|caffe|birra|vino|aranciata|limonata|"
        r"aperitivo|spumante|prosecco|bevanda|bevande|sciroppo|infuso|tisana|smoothie)\b",
        re.IGNORECASE,
    ), "Beverages"),

    # Cleaning Products — EN + IT
    (re.compile(
        r"\b(detergent|dish soap|dishwasher|bleach|cleaner|disinfectant|toilet cleaner|"
        r"laundry|softener|descaler|cleaning|"
        r"detersivo|detersivi|ammorbidente|anticalcare|sgrassatore|candeggina|"
        r"disinfettante|brillantante|pavimenti)\b",
        re.IGNORECASE,
    ), "Cleaning Products"),

    # Personal Care — EN + IT
    (re.compile(
        r"\b(shampoo|conditioner|soap|body wash|deodorant|toothpaste|toothbrush|"
        r"razor|lotion|personal care|"
        r"sapone|bagnoschiuma|dentifricio|spazzolino|rasoio|crema|balsamo|"
        r"assorbente|assorbenti|deodorante|dopobarba|profumo|igiene)\b",
        re.IGNORECASE,
    ), "Personal Care"),

    # Baby — EN + IT
    (re.compile(
        r"\b(diaper|diapers|wipes|formula|baby food|baby|"
        r"pannolino|pannolini|salviette|omogeneizzato|omogeneizzati|neonato|biberon)\b",
        re.IGNORECASE,
    ), "Baby"),

    # Pet Care — EN + IT
    (re.compile(
        r"\b(cat food|dog food|pet food|kibble|litter|treats|pet|"
        r"gatto|lettiera|mangime|crocchette)\b",
        re.IGNORECASE,
    ), "Pet Care"),

    # Household — EN + IT
    (re.compile(
        r"\b(paper towel|paper towels|napkin|napkins|foil|cling film|garbage bag|"
        r"trash bag|bin bag|batteries|light bulb|household|"
        r"tovagliolo|tovaglioli|alluminio|pellicola|batterie|lampadina|"
        r"sacchetti|fazzoletti|scottex)\b",
        re.IGNORECASE,
    ), "Household"),

    # Breakfast & Cereal — EN + IT
    (re.compile(
        r"\b(cereal|granola|oats|muesli|breakfast|"
        r"cereali|fiocchi|avena|colazione|cacao|nesquik)\b",
        re.IGNORECASE,
    ), "Breakfast & Cereal"),

    # Condiments & Spices — EN + IT
    (re.compile(
        r"\b(ketchup|mustard|mayo|mayonnaise|vinegar|hot sauce|soy sauce|peppercorn|"
        r"spice|spices|herb|seasoning|salt|"
        r"senape|maionese|aceto|pepe|spezie|erbe|condimento|sale|origano|rosmarino|"
        r"basilico|prezzemolo|curry|paprika|dado|salsa)\b",
        re.IGNORECASE,
    ), "Condiments & Spices"),

    # Pantry (staples) — EN + IT
    (re.compile(
        r"\b(pasta|rice|flour|oil|sauce|beans|lentils|canned|soup|pantry|sugar|breadcrumbs|noodles|"
        r"riso|farina|olio|sugo|fagioli|lenticchie|conserva|minestra|zucchero|"
        r"pangrattato|pelati|passata|legumi|ceci|polpa|brodo|dispensa)\b",
        re.IGNORECASE,
    ), "Pantry"),

    # Prepared Meals — EN + IT
    (re.compile(
        r"\b(ready meal|prepared|meal deal|sandwich|wrap|sushi|rotisserie|deli|take away|"
        r"gastronomia|rosticceria|piatto pronto)\b",
        re.IGNORECASE,
    ), "Prepared Meals"),
]


def month_start_from_string(month: str | None) -> date:
    if month:
        year_str, month_str = month.split("-", 1)
        return date(int(year_str), int(month_str), 1)
    today = date.today()
    return date(today.year, today.month, 1)


def next_month(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def month_start_for_date(value: date) -> date:
    return date(value.year, value.month, 1)


def month_date_for_day(target_month: date, day: int) -> date:
    last_day = calendar.monthrange(target_month.year, target_month.month)[1]
    return date(target_month.year, target_month.month, min(max(day, 1), last_day))


def normalize_grocery_description(description: str | None) -> str:
    cleaned = re.sub(r"[^a-z0-9&]+", " ", (description or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()[:180]


def normalize_match_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _match_tokens(value: str) -> set[str]:
    return {token for token in normalize_match_text(value).split() if len(token) >= 2}


def is_grocery_category_name(category_name: str | None) -> bool:
    return bool(category_name and "groc" in category_name.lower())


def normalize_transaction_type(value: str | None, default: str = TRANSACTION_TYPE_DEBIT) -> str:
    normalized = (value or default).strip().lower().replace("-", "_").replace(" ", "_")
    mapping = {
        "debit": TRANSACTION_TYPE_DEBIT,
        "expense": TRANSACTION_TYPE_DEBIT,
        "money_out": TRANSACTION_TYPE_DEBIT,
        "outflow": TRANSACTION_TYPE_DEBIT,
        "credit": TRANSACTION_TYPE_CREDIT,
        "income": TRANSACTION_TYPE_CREDIT,
        "money_in": TRANSACTION_TYPE_CREDIT,
        "inflow": TRANSACTION_TYPE_CREDIT,
    }
    return mapping.get(normalized, default)


def normalize_cadence(value: str | None, default: str = CADENCE_ONE_TIME) -> str:
    normalized = (value or default).strip().lower().replace("-", "_").replace(" ", "_")
    mapping = {
        "one_time": CADENCE_ONE_TIME,
        "oneoff": CADENCE_ONE_TIME,
        "one_off": CADENCE_ONE_TIME,
        "once": CADENCE_ONE_TIME,
        "irregular": CADENCE_ONE_TIME,
        "non_recurring": CADENCE_ONE_TIME,
        "monthly": CADENCE_MONTHLY,
        "month": CADENCE_MONTHLY,
        "recurring_monthly": CADENCE_MONTHLY,
        "yearly": CADENCE_YEARLY,
        "annual": CADENCE_YEARLY,
        "annually": CADENCE_YEARLY,
        "recurring_yearly": CADENCE_YEARLY,
        "custom": CADENCE_CUSTOM,
        "every_n_months": CADENCE_CUSTOM,
        "custom_interval": CADENCE_CUSTOM,
        "prepaid": CADENCE_PREPAID,
        "prepaid_subscription": CADENCE_PREPAID,
        "lump_sum": CADENCE_PREPAID,
    }
    return mapping.get(normalized, default)


def cadence_is_recurring(value: str | None) -> bool:
    return normalize_cadence(value) in {CADENCE_MONTHLY, CADENCE_YEARLY, CADENCE_CUSTOM}


def normalize_recurring_settings(cadence: str | None, *, recurring_variable: bool | None = None, recurring_auto_add: bool | None = None) -> tuple[bool, bool]:
    normalized_cadence = normalize_cadence(cadence)
    if not cadence_is_recurring(normalized_cadence):
        return False, False
    return bool(recurring_variable), bool(recurring_auto_add)


def signed_amount(value: Decimal | float, transaction_type: str) -> float:
    amount = float(value)
    return round(amount if normalize_transaction_type(transaction_type) == TRANSACTION_TYPE_CREDIT else -amount, 2)


def _expense_group_key(expense: Expense) -> tuple[str, str, str]:
    merchant_key = re.sub(r"[^a-z0-9]+", " ", expense.merchant.lower()).strip()
    return merchant_key, expense.currency, expense.transaction_type


def _detect_recurring_cadence(group: list[Expense]) -> str | None:
    if len(group) < 2:
        return None
    amounts = [float(item.amount) for item in group]
    avg_amount = sum(amounts) / len(amounts)
    if avg_amount <= 0:
        return None
    if any(abs(amount - avg_amount) / avg_amount > 0.05 for amount in amounts):
        return None
    gaps = [(group[index].expense_date - group[index - 1].expense_date).days for index in range(1, len(group))]
    if not gaps:
        return None
    if all(20 <= gap <= 40 for gap in gaps):
        return CADENCE_MONTHLY
    if all(330 <= gap <= 390 for gap in gaps):
        return CADENCE_YEARLY
    return None


def derive_grocery_subcategory(description: str | None) -> tuple[str, float]:
    normalized = normalize_grocery_description(description)
    if not normalized:
        return "Other Grocery", 0.55
    for pattern, label in GROCERY_SUBCATEGORY_RULES:
        if pattern.search(normalized):
            return label, 0.92
    return "Other Grocery", 0.55


def fuzzy_text_match(value: str, pattern: str) -> bool:
    normalized_value = normalize_match_text(value)
    normalized_pattern = normalize_match_text(pattern)
    if not normalized_value or not normalized_pattern:
        return False
    if normalized_pattern in normalized_value:
        return True
    value_tokens = _match_tokens(normalized_value)
    pattern_tokens = _match_tokens(normalized_pattern)
    if pattern_tokens and pattern_tokens.issubset(value_tokens):
        return True
    if SequenceMatcher(None, normalized_value, normalized_pattern).ratio() >= 0.84:
        return True
    for token in pattern_tokens:
        if any(SequenceMatcher(None, token, candidate).ratio() >= 0.9 for candidate in value_tokens):
            return True
    return False


async def expense_category_name(db: AsyncSession, expense: Expense, category_name: str | None = None) -> str | None:
    if category_name is not None:
        return category_name
    if expense.category is not None:
        return expense.category.name
    if expense.category_id is None:
        return None
    result = await db.execute(select(Category.name).where(Category.id == expense.category_id))
    return result.scalar_one_or_none()


async def ensure_default_categories(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Category.name).where(Category.user_id == user_id))
    existing = {name.lower() for name in result.scalars().all()}
    for name, color, icon, transaction_type in DEFAULT_CATEGORIES:
        if name.lower() not in existing:
            db.add(Category(user_id=user_id, name=name, color=color, icon=icon, transaction_type=transaction_type, is_system=True))
    await db.flush()


async def get_category_by_name(db: AsyncSession, user_id: uuid.UUID, name: str | None, *, transaction_type: str | None = None) -> Category | None:
    if not name:
        return None
    statement = select(Category).where(Category.user_id == user_id, Category.name.ilike(name.strip()))
    if transaction_type:
        statement = statement.where(Category.transaction_type == normalize_transaction_type(transaction_type))
    result = await db.execute(statement)
    return result.scalar_one_or_none()


async def get_or_create_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    name: str | None,
    *,
    transaction_type: str = TRANSACTION_TYPE_DEBIT,
    color: str = "#94a3b8",
) -> Category | None:
    if not name or not name.strip():
        return None
    category = await get_category_by_name(db, user_id, name, transaction_type=transaction_type)
    if category:
        return category
    existing_category = await get_category_by_name(db, user_id, name)
    if existing_category is not None:
        return None
    category = Category(user_id=user_id, name=name.strip(), color=color, transaction_type=normalize_transaction_type(transaction_type))
    db.add(category)
    await db.flush()
    return category


def matches_rule(merchant: str, rule: MerchantRule) -> bool:
    merchant_value = merchant.lower().strip()
    pattern = rule.merchant_pattern.lower().strip()
    if not merchant_value or not pattern:
        return False
    if rule.pattern_type == "regex":
        try:
            return re.search(rule.merchant_pattern, merchant, flags=re.IGNORECASE) is not None
        except re.error:
            return False
    if rule.pattern_type == "fuzzy":
        return fuzzy_text_match(merchant, rule.merchant_pattern)
    return pattern in merchant_value


def _is_subsequence(pattern: str, text: str) -> bool:
    """Return True if every character of *pattern* appears in *text* in order."""
    it = iter(text)
    return all(char in it for char in pattern)


def matches_item_keyword_rule(description: str, rule: ItemKeywordRule) -> bool:
    """Return True if *description* matches *rule* according to its pattern_type.

    Pattern types:
      fuzzy      – smart fuzzy match (existing behaviour)
      contains   – normalized keyword is a substring of the normalized description
      starts_with – any token of the description starts with the keyword
                   e.g. keyword="diges" matches "DIGES. MCVITIE'S" and "DIGESTIVI"
      abbrev     – all keyword chars appear in order inside any single token
                   e.g. keyword="mcvt" matches "MCVITIE" (m·c·v···t inside)
      regex      – full regex against the original description (case-insensitive)
    """
    if rule.pattern_type == "regex":
        try:
            return re.search(rule.keyword, description, flags=re.IGNORECASE) is not None
        except re.error:
            return False
    if rule.pattern_type == "contains":
        return normalize_match_text(rule.keyword) in normalize_match_text(description)
    if rule.pattern_type == "starts_with":
        kw = normalize_match_text(rule.keyword)
        if not kw:
            return False
        return any(token.startswith(kw) for token in normalize_match_text(description).split())
    if rule.pattern_type == "abbrev":
        kw = normalize_match_text(rule.keyword)
        if len(kw) < 2:
            return False
        return any(_is_subsequence(kw, token) for token in normalize_match_text(description).split())
    return fuzzy_text_match(description, rule.keyword)


async def find_matching_category(db: AsyncSession, user_id: uuid.UUID, merchant: str | None, *, transaction_type: str | None = None) -> Category | None:
    if not merchant:
        return None
    normalized_type = normalize_transaction_type(transaction_type) if transaction_type else None
    result = await db.execute(
        select(MerchantRule)
        .where(
            MerchantRule.is_active.is_(True),
            or_(
                (MerchantRule.user_id == user_id) & MerchantRule.is_global.is_(False),
                MerchantRule.is_global.is_(True),
            ),
        )
        # user-specific rules first, then global; within each group order by priority
        .order_by(MerchantRule.is_global.asc(), MerchantRule.priority.asc(), MerchantRule.created_at.asc())
    )
    for rule in result.scalars().all():
        if not rule.category_id:
            continue
        if matches_rule(merchant, rule):
            # For global rules, the category may belong to a different user — look up by id only
            if rule.is_global:
                category_result = await db.execute(select(Category).where(Category.id == rule.category_id))
            else:
                category_result = await db.execute(select(Category).where(Category.id == rule.category_id, Category.user_id == user_id))
            category = category_result.scalar_one_or_none()
            if category is not None and (normalized_type is None or category.transaction_type == normalized_type):
                return category
    return None


async def find_matching_item_subcategory(db: AsyncSession, user_id: uuid.UUID, description: str | None) -> tuple[str, float] | None:
    """Check user-specific rules first (lower priority number = higher precedence),
    then fall back to global rules created by admin."""
    if not description:
        return None
    from sqlalchemy import or_
    result = await db.execute(
        select(ItemKeywordRule)
        .where(
            ItemKeywordRule.is_active.is_(True),
            or_(
                # User's own rules
                (ItemKeywordRule.user_id == user_id) & (ItemKeywordRule.is_global.is_(False)),
                # Admin-created global rules (visible to all)
                ItemKeywordRule.is_global.is_(True),
            ),
        )
        .order_by(
            # User rules first (is_global=False), then global (is_global=True)
            ItemKeywordRule.is_global.asc(),
            ItemKeywordRule.priority.asc(),
            ItemKeywordRule.created_at.asc(),
        )
    )
    for rule in result.scalars().all():
        if matches_item_keyword_rule(description, rule):
            return rule.subcategory_label, 0.98
    return None


async def upsert_item_keyword_rule_from_correction(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    description: str,
    subcategory_label: str,
) -> ItemKeywordRule | None:
    """Auto-create a user-specific keyword rule from a manual subcategory correction.

    Picks the longest normalized token (≥4 chars, non-numeric) as the keyword
    with `contains` matching. Skips if an identical rule already exists.
    """
    tokens = [t for t in normalize_match_text(description).split() if len(t) >= 4 and not t.isdigit()]
    if not tokens:
        return None
    keyword = max(tokens, key=len)

    existing = await db.execute(
        select(ItemKeywordRule).where(
            ItemKeywordRule.user_id == user_id,
            ItemKeywordRule.keyword == keyword,
            ItemKeywordRule.subcategory_label == subcategory_label,
            ItemKeywordRule.is_global.is_(False),
        )
    )
    if existing.scalar_one_or_none() is not None:
        return None

    rule = ItemKeywordRule(
        user_id=user_id,
        is_global=False,
        keyword=keyword,
        subcategory_label=subcategory_label,
        pattern_type="contains",
        priority=50,
        is_active=True,
        notes=f"Auto-created from item correction: {description[:80]}",
    )
    db.add(rule)
    await db.flush()
    return rule


async def resolve_category(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    category_id: uuid.UUID | None = None,
    category_name: str | None = None,
    merchant: str | None = None,
    transaction_type: str = TRANSACTION_TYPE_DEBIT,
) -> Category | None:
    normalized_type = normalize_transaction_type(transaction_type)
    if category_id:
        result = await db.execute(select(Category).where(Category.id == category_id, Category.user_id == user_id))
        category = result.scalar_one_or_none()
        if category is not None and category.transaction_type == normalized_type:
            return category
    if category_name:
        category = await get_or_create_category(db, user_id, category_name, transaction_type=normalized_type)
        if category is not None:
            return category
    return await find_matching_category(db, user_id, merchant, transaction_type=normalized_type)


def normalize_money(value: Decimal | float | str) -> Decimal:
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return amount.quantize(Decimal("0.01"))


def expense_requires_review(category: Category | None, confidence: float, source: str) -> bool:
    if category is None:
        return True
    if source == "receipt" and confidence < settings.receipt_review_confidence_threshold:
        return True
    return False


def serialize_category(category: Category) -> dict:
    return {
        "id": str(category.id),
        "name": category.name,
        "color": category.color,
        "icon": category.icon,
        "description": category.description,
        "transaction_type": category.transaction_type,
        "is_system": category.is_system,
        "created_at": category.created_at.isoformat(),
        "updated_at": category.updated_at.isoformat(),
    }


def serialize_rule(rule: MerchantRule, category_name: str | None = None) -> dict:
    return {
        "id": str(rule.id),
        "category_id": str(rule.category_id) if rule.category_id else None,
        "category_name": category_name,
        "merchant_pattern": rule.merchant_pattern,
        "pattern_type": rule.pattern_type,
        "priority": rule.priority,
        "is_active": rule.is_active,
        "is_global": rule.is_global,
        "notes": rule.notes,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


def serialize_item_rule(rule: ItemKeywordRule) -> dict:
    return {
        "id": str(rule.id),
        "keyword": rule.keyword,
        "subcategory_label": rule.subcategory_label,
        "pattern_type": rule.pattern_type,
        "priority": rule.priority,
        "is_global": rule.is_global,
        "is_active": rule.is_active,
        "notes": rule.notes,
        "created_at": rule.created_at.isoformat(),
        "updated_at": rule.updated_at.isoformat(),
    }


def serialize_budget(budget: Budget, category_name: str | None = None, actual: float | None = None) -> dict:
    amount = float(budget.amount)
    actual_value = actual or 0.0
    return {
        "id": str(budget.id),
        "name": budget.name,
        "category_id": str(budget.category_id) if budget.category_id else None,
        "category_name": category_name,
        "amount": amount,
        "currency": budget.currency,
        "period": budget.period,
        "month_start": budget.month_start.isoformat(),
        "notes": budget.notes,
        "actual": round(actual_value, 2),
        "remaining": round(amount - actual_value, 2),
        "created_at": budget.created_at.isoformat(),
        "updated_at": budget.updated_at.isoformat(),
    }


def serialize_receipt(receipt: Receipt) -> dict:
    return {
        "id": str(receipt.id),
        "original_filename": receipt.original_filename,
        "stored_filename": receipt.stored_filename,
        "content_type": receipt.content_type,
        "file_size": receipt.file_size,
        "ocr_text": receipt.ocr_text,
        "preview": receipt.preview_data,
        "extraction_confidence": receipt.extraction_confidence,
        "document_kind": receipt.document_kind,
        "extraction_status": receipt.extraction_status,
        "needs_review": receipt.needs_review,
        "review_notes": receipt.review_notes,
        "created_at": receipt.created_at.isoformat(),
        "updated_at": receipt.updated_at.isoformat(),
        "finalized_at": receipt.finalized_at.isoformat() if receipt.finalized_at else None,
    }


def serialize_expense_item(item: ExpenseItem) -> dict:
    return {
        "id": str(item.id),
        "description": item.description,
        "quantity": item.quantity,
        "unit_price": float(item.unit_price) if item.unit_price is not None else None,
        "total": float(item.total_price) if item.total_price is not None else None,
        "subcategory": item.subcategory,
        "subcategory_confidence": item.subcategory_confidence,
    }


def _compute_prepaid_end_date(expense: Expense) -> str | None:
    """Return the last day of the final prepaid month, or None if not applicable."""
    if expense.cadence != CADENCE_PREPAID:
        return None
    start = expense.prepaid_start_date or expense.expense_date
    months = expense.prepaid_months
    if not start or not months:
        return None
    total = start.month - 1 + months
    end_year = start.year + total // 12
    end_month = total % 12 + 1
    last_day = calendar.monthrange(end_year, end_month)[1]
    return date(end_year, end_month, last_day).isoformat()


def serialize_expense(
    expense: Expense,
    *,
    category_name: str | None = None,
    receipt_filename: str | None = None,
    include_items: bool = False,
    receipt_preview: dict | None = None,
    receipt_document_kind: str | None = None,
    receipt_ocr_text: str | None = None,
) -> dict:
    payload = {
        "id": str(expense.id),
        "merchant": expense.merchant,
        "description": expense.description,
        "amount": float(expense.amount),
        "signed_amount": signed_amount(expense.amount, expense.transaction_type),
        "transaction_type": expense.transaction_type,
        "currency": expense.currency,
        "expense_date": expense.expense_date.isoformat(),
        "source": expense.source,
        "confidence": expense.confidence,
        "needs_review": expense.needs_review,
        "notes": expense.notes,
        "is_recurring": expense.is_recurring,
        "recurring_group": expense.recurring_group,
        "cadence": expense.cadence,
        "cadence_override": expense.cadence_override,
        "recurring_variable": expense.recurring_variable,
        "recurring_auto_add": expense.recurring_auto_add,
        "recurring_source_expense_id": str(expense.recurring_source_expense_id) if expense.recurring_source_expense_id else None,
        "auto_generated": expense.auto_generated,
        "generated_for_month": expense.generated_for_month.isoformat() if expense.generated_for_month else None,
        "cadence_interval": expense.cadence_interval,
        "prepaid_months": expense.prepaid_months,
        "prepaid_start_date": expense.prepaid_start_date.isoformat() if expense.prepaid_start_date else None,
        "prepaid_end_date": _compute_prepaid_end_date(expense),
        "is_major_purchase": expense.is_major_purchase,
        "category_id": str(expense.category_id) if expense.category_id else None,
        "category_name": category_name,
        "receipt_id": str(expense.receipt_id) if expense.receipt_id else None,
        "receipt_filename": receipt_filename,
        "created_at": expense.created_at.isoformat(),
        "updated_at": expense.updated_at.isoformat(),
    }
    if include_items:
        payload["items"] = [serialize_expense_item(item) for item in expense.items]
        payload["receipt_preview"] = receipt_preview
        payload["receipt_document_kind"] = receipt_document_kind
        payload["receipt_ocr_text"] = receipt_ocr_text
    return payload


def _coerce_optional_money(value: Decimal | float | str | None) -> Decimal | None:
    if value in (None, ""):
        return None
    return normalize_money(value)


def _coerce_optional_float(value: float | str | None) -> float | None:
    if value in (None, ""):
        return None
    return round(float(value), 2)


def _item_value(item: object, field_name: str):
    if isinstance(item, dict):
        return item.get(field_name)
    return getattr(item, field_name, None)


async def replace_expense_items(db: AsyncSession, expense: Expense, items: list[object] | None, *, category_name: str | None = None) -> None:
    resolved_category_name = await expense_category_name(db, expense, category_name)
    is_grocery_expense = is_grocery_category_name(resolved_category_name)
    normalized_items: list[ExpenseItem] = []
    derived_subcategory_count = 0
    for item in items or []:
        description = str(_item_value(item, "description") or "").strip()[:300]
        total_price = _coerce_optional_money(_item_value(item, "total"))
        if not description and total_price is None:
            continue
        subcategory = str(_item_value(item, "subcategory") or "").strip()[:120] or None
        subcategory_confidence = _coerce_optional_float(_item_value(item, "subcategory_confidence"))
        if is_grocery_expense and not subcategory:
            matched_subcategory = await find_matching_item_subcategory(db, expense.user_id, description)
            if matched_subcategory is not None:
                subcategory, subcategory_confidence = matched_subcategory
        if is_grocery_expense and not subcategory:
            from app.services.item_rag import find_similar_subcategory
            rag_result = await find_similar_subcategory(db, expense.user_id, description)
            if rag_result is not None:
                subcategory, subcategory_confidence = rag_result
        if is_grocery_expense and not subcategory:
            subcategory, subcategory_confidence = derive_grocery_subcategory(description)
            derived_subcategory_count += 1
        normalized_items.append(
            ExpenseItem(
                expense_id=expense.id,
                description=description or "Item",
                quantity=_coerce_optional_float(_item_value(item, "quantity")),
                unit_price=_coerce_optional_money(_item_value(item, "unit_price")),
                total_price=total_price,
                subcategory=subcategory,
                subcategory_confidence=subcategory_confidence,
            )
        )

    await db.execute(
        delete(ExpenseItem)
        .where(ExpenseItem.expense_id == expense.id)
        .execution_options(synchronize_session=False)
    )
    if normalized_items:
        db.add_all(normalized_items)
    await db.flush()
    set_committed_value(expense, "items", list(normalized_items))
    if is_grocery_expense and normalized_items:
        logger.info(
            "spendhound.expense_items.subcategories_assigned",
            expense_id=str(expense.id),
            item_count=len(normalized_items),
            derived_subcategory_count=derived_subcategory_count,
        )


async def recompute_recurring_expenses(db: AsyncSession, user_id: uuid.UUID) -> None:
    result = await db.execute(select(Expense).where(Expense.user_id == user_id).order_by(Expense.expense_date.asc()))
    expenses = result.scalars().all()
    grouped: dict[tuple[str, str, str], list[Expense]] = defaultdict(list)

    for expense in expenses:
        expense.is_recurring = False
        expense.recurring_group = None
        if expense.cadence_override:
            overridden_cadence = normalize_cadence(expense.cadence_override)
            expense.cadence = overridden_cadence
            if cadence_is_recurring(overridden_cadence):
                merchant_key, currency, transaction_type = _expense_group_key(expense)
                expense.is_recurring = True
                expense.recurring_group = f"manual:{merchant_key}:{currency}:{transaction_type}:{overridden_cadence}"
            continue

        expense.cadence = CADENCE_ONE_TIME
        grouped[_expense_group_key(expense)].append(expense)

    for (merchant_key, currency, transaction_type), group in grouped.items():
        if not merchant_key:
            continue
        detected_cadence = _detect_recurring_cadence(group)
        if detected_cadence is None:
            continue
        avg_amount = sum(float(item.amount) for item in group) / len(group)
        recurring_group = f"{merchant_key}:{currency}:{transaction_type}:{detected_cadence}:{avg_amount:.2f}"
        for expense in group:
            expense.cadence = detected_cadence
            expense.is_recurring = True
            expense.recurring_group = recurring_group

    for expense in expenses:
        if normalize_transaction_type(expense.transaction_type) != TRANSACTION_TYPE_DEBIT or expense.cadence != CADENCE_ONE_TIME:
            expense.is_major_purchase = False
    await db.flush()


def recurring_expense_is_due_for_month(expense: Expense, target_month: date) -> bool:
    cadence = normalize_cadence(expense.cadence_override or expense.cadence)
    template_month = month_start_for_date(expense.expense_date)
    if target_month <= template_month:
        return False
    if cadence == CADENCE_MONTHLY:
        return True
    if cadence == CADENCE_YEARLY:
        return expense.expense_date.month == target_month.month
    if cadence == CADENCE_CUSTOM:
        interval = expense.cadence_interval or 1
        months_since = (target_month.year - template_month.year) * 12 + (target_month.month - template_month.month)
        return months_since % interval == 0
    return False


async def generate_recurring_expenses_for_month(db: AsyncSession, user_id: uuid.UUID, target_month: date) -> list[Expense]:
    target_month = month_start_for_date(target_month)
    result = await db.execute(
        select(Expense)
        .where(
            Expense.user_id == user_id,
            Expense.recurring_auto_add.is_(True),
            Expense.auto_generated.is_(False),
        )
        .order_by(Expense.expense_date.asc(), Expense.created_at.asc())
    )
    generated_expenses: list[Expense] = []

    for template in result.scalars().all():
        cadence = normalize_cadence(template.cadence_override or template.cadence)
        if not cadence_is_recurring(cadence):
            continue
        if not recurring_expense_is_due_for_month(template, target_month):
            continue

        existing_result = await db.execute(
            select(Expense.id).where(
                Expense.user_id == user_id,
                Expense.recurring_source_expense_id == template.id,
                Expense.generated_for_month == target_month,
            ).limit(1)
        )
        if existing_result.scalar_one_or_none() is not None:
            continue

        generated_expense = Expense(
            user_id=user_id,
            merchant=template.merchant,
            description=template.description,
            amount=template.amount,
            transaction_type=template.transaction_type,
            currency=template.currency,
            expense_date=month_date_for_day(target_month, template.expense_date.day),
            category_id=template.category_id,
            receipt_id=None,
            notes=template.notes,
            source="auto_recurring",
            confidence=1.0,
            needs_review=template.recurring_variable or template.category_id is None,
            recurring_group=template.recurring_group,
            is_recurring=True,
            cadence=cadence,
            cadence_override=template.cadence_override or cadence,
            cadence_interval=template.cadence_interval,
            recurring_variable=template.recurring_variable,
            recurring_auto_add=template.recurring_auto_add,
            recurring_source_expense_id=template.id,
            auto_generated=True,
            generated_for_month=target_month,
            is_major_purchase=False,
        )
        db.add(generated_expense)
        generated_expenses.append(generated_expense)

    if generated_expenses:
        await db.flush()
        await recompute_recurring_expenses(db, user_id)
    return generated_expenses


def apply_expense_filters(
    statement,
    *,
    user_id: uuid.UUID,
    month: str | None = None,
    category_id: uuid.UUID | None = None,
    transaction_type: str | None = None,
    cadence: str | None = None,
    review_only: bool = False,
    search: str | None = None,
):
    statement = statement.where(Expense.user_id == user_id)
    if month and month not in {"all", "all_time"}:
        start = month_start_from_string(month)
        statement = statement.where(Expense.expense_date >= start, Expense.expense_date < next_month(start))
    if category_id:
        statement = statement.where(Expense.category_id == category_id)
    if transaction_type:
        statement = statement.where(Expense.transaction_type == normalize_transaction_type(transaction_type))
    if cadence and cadence not in {"all", "auto"}:
        statement = statement.where(Expense.cadence == normalize_cadence(cadence))
    if review_only:
        statement = statement.where((Expense.needs_review.is_(True)) | (Expense.category_id.is_(None)))
    if search:
        like_value = f"%{search.strip()}%"
        statement = statement.where(Expense.merchant.ilike(like_value) | Expense.description.ilike(like_value))
    return statement


async def delete_orphaned_category_rules(db: AsyncSession, category_id: uuid.UUID) -> None:
    await db.execute(delete(MerchantRule).where(MerchantRule.category_id == category_id, MerchantRule.is_active.is_(False)))
