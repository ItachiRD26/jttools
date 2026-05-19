// LOCATION: lib/hooks/usePaypalSubscription.ts
// Hook para manejar el flujo completo de suscripción con PayPal

import { useState } from "react";
import { getAuth } from "firebase/auth";

interface SubscribeOptions {
  planId: string;
  onSuccess?: (apiKey: string) => void;
  onError?: (error: string) => void;
}

export function usePaypalSubscription() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Obtiene el Firebase ID token del usuario actual */
  async function getToken(): Promise<string> {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Not authenticated");
    return user.getIdToken();
  }

  /**
   * Inicia el flujo de suscripción:
   * 1. Crea la suscripción en PayPal
   * 2. Redirige al usuario a PayPal para aprobar
   */
  async function subscribe({ planId, onError }: SubscribeOptions) {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch("/api/paypal/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to create subscription");
      }

      // Guardar subscriptionId en sessionStorage para usarlo al volver
      sessionStorage.setItem("pending_subscription_id", data.subscriptionId);
      sessionStorage.setItem("pending_plan_id", planId);

      // Redirigir a PayPal para que el usuario apruebe
      window.location.href = data.approvalUrl;

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Llamar esta función en /dashboard cuando PayPal redirige de vuelta.
   * Lee el subscriptionId de sessionStorage y activa el plan.
   *
   * Uso en tu página de dashboard:
   *   const { activateAfterRedirect } = usePaypalSubscription();
   *   useEffect(() => {
   *     const params = new URLSearchParams(window.location.search);
   *     if (params.get("subscription_success") === "1") {
   *       activateAfterRedirect({ onSuccess: (key) => console.log(key) });
   *     }
   *   }, []);
   */
  async function activateAfterRedirect({ onSuccess, onError }: Omit<SubscribeOptions, "planId">) {
    const subscriptionId = sessionStorage.getItem("pending_subscription_id");

    if (!subscriptionId) {
      const msg = "No pending subscription found";
      setError(msg);
      onError?.(msg);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch("/api/paypal/activate-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subscriptionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to activate subscription");
      }

      // Limpiar sessionStorage
      sessionStorage.removeItem("pending_subscription_id");
      sessionStorage.removeItem("pending_plan_id");

      onSuccess?.(data.apiKey);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }

  return { subscribe, activateAfterRedirect, loading, error };
}