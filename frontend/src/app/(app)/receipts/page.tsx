import { redirect } from "next/navigation";

export default function ReceiptsPage() {
  redirect("/expenses/new?tab=upload-receipt");
}
