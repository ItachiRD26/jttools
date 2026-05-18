// LOCATION: lib/pushover.ts
// Pushover push notifications for sale alerts
// Docs: https://pushover.net/api

const PUSHOVER_API = "https://api.pushover.net/1/messages.json";

export interface PushoverMessage {
  title:    string;
  message:  string;
  url?:     string;
  url_title?: string;
  priority?: -2 | -1 | 0 | 1 | 2; // -1=low, 0=normal, 1=high, 2=emergency
  sound?:   string;
}

export async function sendPushover(
  userKey:  string,
  appToken: string,
  msg:      PushoverMessage
): Promise<boolean> {
  try {
    const res = await fetch(PUSHOVER_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        token:     appToken,
        user:      userKey,
        title:     msg.title,
        message:   msg.message,
        url:       msg.url,
        url_title: msg.url_title,
        priority:  msg.priority ?? 0,
        sound:     msg.sound ?? "cashregister",
      }),
    });
    const data = await res.json();
    if (data.status !== 1) {
      console.error("[Pushover] Failed:", data.errors);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Pushover] Error:", err);
    return false;
  }
}

// Format a sale notification
export function formatSaleNotification(sale: {
  shopName:    string;
  orderId:     string | number;
  amount:      number;
  currency:    string;
  itemCount:   number;
  buyerCity?:  string;
}) {
  return {
    title:     `💰 New sale — ${sale.shopName}`,
    message:   `Order #${sale.orderId}\n$${sale.amount.toFixed(2)} ${sale.currency}\n${sale.itemCount} item${sale.itemCount !== 1 ? "s" : ""}${sale.buyerCity ? ` · ${sale.buyerCity}` : ""}`,
    url:       `https://www.etsy.com/your/orders/${sale.orderId}`,
    url_title: "View order on Etsy",
    sound:     "cashregister",
    priority:  0 as const,
  };
}