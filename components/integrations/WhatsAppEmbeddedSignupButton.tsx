"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import type { IntegrationRecord } from "@/components/admin/IntegrationCard";
import { NeonButton } from "@/components/shared/NeonButton";

type FacebookLoginResponse = {
  status?: string;
  authResponse?: {
    code?: string;
  };
};

type FacebookSdk = {
  init: (options: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        sessionInfoVersion: number;
      };
    }
  ) => void;
};

type EmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: Record<string, unknown>;
};

type SignupResult = {
  wabaId: string;
  phoneNumberId: string;
};

type StatusPayload = {
  connected: boolean;
  wabaId: string | null;
  phoneNumberId: string | null;
  tokenExists: boolean;
  lastConnectedAt: string | null;
  webhookUrl: string;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

let facebookSdkPromise: Promise<void> | null = null;

function loadFacebookSdk(appId: string, graphVersion: string) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Facebook SDK can only load in the browser."));
  }

  if (window.FB) {
    return Promise.resolve();
  }

  if (facebookSdkPromise) {
    return facebookSdkPromise;
  }

  facebookSdkPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById("facebook-jssdk");
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: false,
        version: graphVersion
      });
      resolve();
    };

    if (existingScript) {
      if (window.FB) {
        resolve();
      }
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      facebookSdkPromise = null;
      reject(new Error("Facebook SDK failed to load."));
    };
    document.body.appendChild(script);
  });

  return facebookSdkPromise;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseSignupMessage(data: unknown): EmbeddedSignupMessage | null {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as EmbeddedSignupMessage;
    } catch {
      return null;
    }
  }

  if (data && typeof data === "object") {
    return data as EmbeddedSignupMessage;
  }

  return null;
}

function signupResultFromMessage(message: EmbeddedSignupMessage): SignupResult | null {
  if (message.type !== "WA_EMBEDDED_SIGNUP" || message.event !== "FINISH") {
    return null;
  }

  const data = message.data ?? {};
  const wabaId = readString(data.waba_id) ?? readString(data.wabaId);
  const phoneNumberId = readString(data.phone_number_id) ?? readString(data.phoneNumberId);

  return wabaId && phoneNumberId ? { wabaId, phoneNumberId } : null;
}

function createEmbeddedSignupWaiter(timeoutMs = 120_000) {
  let cleanup = () => {};

  const promise = new Promise<SignupResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("WhatsApp onboarding timed out before returning a phone number."));
    }, timeoutMs);

    cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };

    function finish(result: SignupResult) {
      cleanup();
      resolve(result);
    }

    function fail(message: string) {
      cleanup();
      reject(new Error(message));
    }

    function onMessage(event: MessageEvent<unknown>) {
      const allowedOrigins = new Set(["https://www.facebook.com", "https://web.facebook.com"]);
      if (!allowedOrigins.has(event.origin)) {
        return;
      }

      const message = parseSignupMessage(event.data);
      if (!message || message.type !== "WA_EMBEDDED_SIGNUP") {
        return;
      }

      if (message.event === "CANCEL") {
        fail("WhatsApp onboarding was cancelled.");
        return;
      }

      if (message.event === "ERROR") {
        fail("WhatsApp onboarding failed. Please try again.");
        return;
      }

      const result = signupResultFromMessage(message);
      if (result) {
        finish(result);
      }
    }

    window.addEventListener("message", onMessage);
  });

  return { promise, cancel: cleanup };
}

function facebookLogin(configId: string) {
  return new Promise<FacebookLoginResponse>((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK is not ready."));
      return;
    }

    window.FB.login(resolve, {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        sessionInfoVersion: 3
      }
    });
  });
}

function formatStatus(status: StatusPayload | null) {
  if (!status) {
    return null;
  }

  if (!status.connected) {
    return "WhatsApp is not connected through Embedded Signup yet.";
  }

  return `Connected WABA ${status.wabaId ?? "saved"} / Phone ${status.phoneNumberId ?? "saved"}.`;
}

export function WhatsAppEmbeddedSignupButton({
  companyId,
  companyName,
  onConnected
}: {
  companyId: string;
  companyName: string;
  onConnected?: (payload: { integration: IntegrationRecord; message: string }) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let active = true;

    fetch(`/api/admin/companies/${companyId}/integrations/whatsapp/status`)
      .then((response) => response.json())
      .then((data: StatusPayload) => {
        if (active) {
          setStatus(data);
        }
      })
      .catch(() => {
        if (active) {
          setStatus(null);
        }
      });

    return () => {
      active = false;
    };
  }, [companyId]);

  async function startSignup() {
    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const configId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
    const graphVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || "v20.0";

    setError(null);
    setNotice(null);

    if (!appId || !configId) {
      setError("Meta Embedded Signup is not configured.");
      return;
    }

    setLoading(true);
    let signupWaiter: ReturnType<typeof createEmbeddedSignupWaiter> | null = null;
    try {
      await loadFacebookSdk(appId, graphVersion);
      signupWaiter = createEmbeddedSignupWaiter();
      const loginResponse = await facebookLogin(configId);
      const code = loginResponse.authResponse?.code;

      if (!code) {
        throw new Error("Meta did not return an authorization code.");
      }

      const signupResult = await signupWaiter.promise;
      const response = await fetch(
        `/api/admin/companies/${companyId}/integrations/whatsapp-embedded-signup/callback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            code,
            waba_id: signupResult.wabaId,
            phone_number_id: signupResult.phoneNumberId
          })
        }
      );

      const payload = (await response.json()) as {
        ok?: boolean;
        integration?: IntegrationRecord;
        message?: string;
        error?: string | { message?: string };
        status?: StatusPayload;
      };

      if (!response.ok || !payload.integration) {
        const backendError =
          payload.message ??
          (typeof payload.error === "string" ? payload.error : payload.error?.message) ??
          "WhatsApp Embedded Signup could not be saved.";
        throw new Error(backendError);
      }

      const message = payload.message ?? `WhatsApp connected successfully for ${companyName}.`;
      setNotice(message);
      setStatus(payload.status ?? null);
      onConnected?.({ integration: payload.integration, message });
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "WhatsApp Embedded Signup failed.");
    } finally {
      signupWaiter?.cancel();
      setLoading(false);
    }
  }

  const currentStatus = formatStatus(status);

  return (
    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-100">Embedded Signup</p>
          {currentStatus ? <p className="mt-1 text-xs leading-5 text-emerald-100/75">{currentStatus}</p> : null}
        </div>
        <NeonButton type="button" size="sm" loading={loading} onClick={startSignup}>
          <MessageCircle className="h-3.5 w-3.5" />
          Connect WhatsApp
        </NeonButton>
      </div>
      {notice ? (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-emerald-100">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {notice}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs font-semibold text-rose-200">{error}</p> : null}
    </div>
  );
}
