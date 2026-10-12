import { MessageCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SUPPORT, whatsappLink } from "@/lib/support";

/** Floating "Chat with us" on the public site; nothing when no WhatsApp number is set. */
export async function WhatsAppButton() {
  if (!SUPPORT.whatsapp) return null;
  const t = await getTranslations("marketing.contact");
  return (
    <a
      href={whatsappLink(SUPPORT.whatsapp, t("whatsappMessage"))}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 print:hidden"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      <span>{t("floating")}</span>
    </a>
  );
}
