import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type {
  CreateProductApiKeyRequest,
  CreateProductApiKeyResponse,
  ProductApiAuthInfo,
  ProductApiKeyStatus,
  ProductApiQuotaKey,
  ProductApiQuotaPolicy,
  ProductApiScope,
  ProductApiUser
} from "@agent-bomber/protocol";
import { HttpError } from "./errors.js";

export const PRODUCT_API_KEY_HEADER = "x-agent-jola-key";
export const LEGACY_PRODUCT_API_KEY_HEADER = "x-agent-poppy-key";
export const PRODUCT_API_ADMIN_KEY_HEADER = "x-agent-jola-admin-key";
export const LEGACY_PRODUCT_API_ADMIN_KEY_HEADER = "x-agent-poppy-admin-key";
export const DEFAULT_LOCAL_PRODUCT_API_KEY = "agent-jola-local-dev-key";
export const LEGACY_DEFAULT_LOCAL_PRODUCT_API_KEY = "agent-poppy-local-dev-key";
const ISSUED_PRODUCT_API_KEY_PREFIX = "ap_issued_";
type ProductApiKeyStatusLookup = (keyId: string) => ProductApiKeyStatus;
let productApiKeyStatusLookup: ProductApiKeyStatusLookup | undefined;

export const ALL_PRODUCT_API_SCOPES: ProductApiScope[] = [
  "profile:read",
  "profile:write",
  "templates:read",
  "rooms:read",
  "rooms:write",
  "bridge",
  "leaderboard:read"
];

const DEFAULT_PRODUCT_API_QUOTAS: Record<
  ProductApiQuotaKey,
  { label: string; limit: number | null }
> = {
  character_randomize: { label: "Character randomization", limit: null },
  room_create: { label: "Room creation", limit: null },
  template_read: { label: "Strategy template reads", limit: null },
  template_apply: { label: "Strategy template applies", limit: null },
  bridge_prompt: { label: "Provider bridge prompts", limit: null }
};

interface ProductApiCredential {
  key: string;
  user: ProductApiUser;
}

export function configureProductApiKeyStatusLookup(
  lookup: ProductApiKeyStatusLookup | undefined
): void {
  productApiKeyStatusLookup = lookup;
}

export function productApiUser(
  scopes: ProductApiScope[] = ALL_PRODUCT_API_SCOPES,
  mode: ProductApiUser["mode"] = "local-dev"
): ProductApiUser {
  return {
    id: "local-user",
    handle: "local-user",
    mode,
    scopes
  };
}

export function productApiAuthInfo(): ProductApiAuthInfo {
  const source = envValue("AGENT_JOLA_API_KEY", "AGENT_POPPY_API_KEY")
    ? "env"
    : envValue("AGENT_JOLA_KEY_ISSUER_SECRET", "AGENT_POPPY_KEY_ISSUER_SECRET")
      ? "issuer"
      : process.env.NODE_ENV === "production"
        ? "missing"
        : "local-dev-default";
  return {
    header: "X-Agent-Jola-Key",
    legacyHeaders: ["X-Agent-Poppy-Key"],
    authorization: "Bearer",
    source,
    scopes: source === "missing" ? [] : ALL_PRODUCT_API_SCOPES
  };
}

export function productApiQuotaPolicies(): ProductApiQuotaPolicy[] {
  const configured = parseQuotaEnv(envValue("AGENT_JOLA_QUOTAS", "AGENT_POPPY_QUOTAS"));
  return (Object.keys(DEFAULT_PRODUCT_API_QUOTAS) as ProductApiQuotaKey[]).map((key) => {
    const base = DEFAULT_PRODUCT_API_QUOTAS[key];
    const limit = configured[key] ?? base.limit;
    return {
      key,
      label: base.label,
      limit,
      remaining: limit
    };
  });
}

export function requireProductApiKey(request: FastifyRequest): ProductApiUser {
  const acceptedCredentials = acceptedProductApiCredentials();
  const provided = productApiKeyFromRequest(request);
  const credential = acceptedCredentials.find((candidate) => candidate.key === provided);
  if (provided && credential) {
    return credential.user;
  }

  const issued = provided ? verifyIssuedProductApiKey(provided) : undefined;
  if (issued) {
    return issued.user;
  }

  if (acceptedCredentials.length === 0 && !productApiIssuerSecret()) {
    throw new HttpError(
      503,
      "Product API key is not configured.",
      "PRODUCT_API_KEY_NOT_CONFIGURED"
    );
  }

  if (!provided) {
    throw new HttpError(401, "Missing Agent Jola API key.", "PRODUCT_API_KEY_INVALID");
  }
  if (!credential) {
    throw new HttpError(401, "Missing or invalid Agent Jola API key.", "PRODUCT_API_KEY_INVALID");
  }
  return credential.user;
}

export function requireProductApiScope(
  request: FastifyRequest,
  scope: ProductApiScope
): ProductApiUser {
  const user = requireProductApiKey(request);
  if (!user.scopes.includes(scope)) {
    throw new HttpError(
      403,
      `Agent Jola API key is missing scope: ${scope}`,
      "PRODUCT_API_KEY_SCOPE_MISSING"
    );
  }
  return user;
}

export function requireProductApiAdminKey(request: FastifyRequest): void {
  const expected = envValue("AGENT_JOLA_ADMIN_KEY", "AGENT_POPPY_ADMIN_KEY");
  if (!expected) {
    throw new HttpError(
      503,
      "Product API key issuer admin key is not configured.",
      "PRODUCT_API_ADMIN_KEY_NOT_CONFIGURED"
    );
  }
  const provided =
    headerValue(request.headers[PRODUCT_API_ADMIN_KEY_HEADER])?.trim() ??
    headerValue(request.headers[LEGACY_PRODUCT_API_ADMIN_KEY_HEADER])?.trim();
  if (!provided || provided !== expected) {
    throw new HttpError(
      401,
      "Missing or invalid Agent Jola admin key.",
      "PRODUCT_API_ADMIN_KEY_INVALID"
    );
  }
}

export function issueProductApiKey(
  input: CreateProductApiKeyRequest = {}
): CreateProductApiKeyResponse {
  return issueProductApiKeyForOwner(input, {
    id: `user_${randomUUID()}`,
    handle: cleanHandle(input.handle)
  });
}

export function issueProductApiKeyForUser(
  input: CreateProductApiKeyRequest,
  owner: { id: string; handle: string }
): CreateProductApiKeyResponse {
  return issueProductApiKeyForOwner(input, {
    id: owner.id,
    handle: cleanHandle(input.handle ?? owner.handle)
  });
}

function issueProductApiKeyForOwner(
  input: CreateProductApiKeyRequest,
  owner: { id: string; handle: string }
): CreateProductApiKeyResponse {
  const secret = productApiIssuerSecret();
  if (!secret) {
    throw new HttpError(
      503,
      "Product API key issuer secret is not configured.",
      "PRODUCT_API_KEY_ISSUER_NOT_CONFIGURED"
    );
  }
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
  const keyId = `key_${randomUUID()}`;
  const payload: SignedProductApiPayload = {
    jti: keyId,
    sub: owner.id,
    handle: owner.handle,
    mode: "issued",
    scopes: normalizeProductApiScopes(input.scopes),
    iat: issuedAtSeconds
  };
  if (ttlSeconds !== undefined) {
    payload.exp = issuedAtSeconds + ttlSeconds;
  }
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadPart, secret);
  const user: ProductApiUser = {
    id: payload.sub,
    handle: payload.handle,
    mode: payload.mode,
    scopes: payload.scopes
  };
  const response: CreateProductApiKeyResponse = {
    id: keyId,
    key: `${ISSUED_PRODUCT_API_KEY_PREFIX}${payloadPart}.${signature}`,
    user,
    createdAt: new Date(issuedAtSeconds * 1000).toISOString()
  };
  if (payload.exp !== undefined) {
    response.expiresAt = new Date(payload.exp * 1000).toISOString();
  }
  return response;
}

function acceptedProductApiCredentials(): ProductApiCredential[] {
  const configured = envValue("AGENT_JOLA_API_KEY", "AGENT_POPPY_API_KEY");
  if (configured) {
    return configured
      .split(",")
      .map(parseConfiguredCredential)
      .filter((credential): credential is ProductApiCredential => credential !== undefined);
  }
  if (process.env.NODE_ENV === "production") {
    return [];
  }
  return [DEFAULT_LOCAL_PRODUCT_API_KEY, LEGACY_DEFAULT_LOCAL_PRODUCT_API_KEY].map((key) => ({
    key,
    user: productApiUser(ALL_PRODUCT_API_SCOPES, "local-dev")
  }));
}

function parseConfiguredCredential(entry: string): ProductApiCredential | undefined {
  const [rawKey, rawScopes] = entry.split("|", 2);
  const key = rawKey?.trim();
  if (!key) {
    return undefined;
  }
  const scopes = rawScopes ? parseScopes(rawScopes) : ALL_PRODUCT_API_SCOPES;
  return { key, user: productApiUser(scopes, "configured") };
}

function parseScopes(value: string): ProductApiScope[] {
  const requested = new Set(
    value
      .split("+")
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
  const scopes = ALL_PRODUCT_API_SCOPES.filter((scope) => requested.has(scope));
  return scopes.length > 0 ? scopes : ALL_PRODUCT_API_SCOPES;
}

interface SignedProductApiPayload {
  jti: string;
  sub: string;
  handle: string;
  mode: "issued";
  scopes: ProductApiScope[];
  iat: number;
  exp?: number;
}

function verifyIssuedProductApiKey(key: string): ProductApiCredential | undefined {
  const secret = productApiIssuerSecret();
  if (!secret || !key.startsWith(ISSUED_PRODUCT_API_KEY_PREFIX)) {
    return undefined;
  }
  const token = key.slice(ISSUED_PRODUCT_API_KEY_PREFIX.length);
  const [payloadPart, signature] = token.split(".", 2);
  if (
    !payloadPart ||
    !signature ||
    !constantTimeEqual(signature, signPayload(payloadPart, secret))
  ) {
    return undefined;
  }
  const payload = parseSignedPayload(payloadPart);
  if (!payload) {
    return undefined;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp <= now) {
    return undefined;
  }
  const storedStatus = productApiKeyStatusLookup?.(payload.jti);
  if (storedStatus && storedStatus !== "active") {
    return undefined;
  }
  return {
    key,
    user: {
      id: payload.sub,
      handle: payload.handle,
      mode: "issued",
      scopes: normalizeProductApiScopes(payload.scopes)
    }
  };
}

function parseSignedPayload(payloadPart: string): SignedProductApiPayload | undefined {
  try {
    const parsed = JSON.parse(base64UrlDecode(payloadPart)) as Partial<SignedProductApiPayload>;
    if (
      typeof parsed.jti !== "string" ||
      typeof parsed.sub !== "string" ||
      typeof parsed.handle !== "string" ||
      parsed.mode !== "issued" ||
      !Array.isArray(parsed.scopes) ||
      typeof parsed.iat !== "number"
    ) {
      return undefined;
    }
    const payload: SignedProductApiPayload = {
      jti: parsed.jti,
      sub: parsed.sub,
      handle: cleanHandle(parsed.handle),
      mode: "issued",
      scopes: normalizeProductApiScopes(parsed.scopes),
      iat: parsed.iat
    };
    if (typeof parsed.exp === "number") {
      payload.exp = parsed.exp;
    }
    return payload;
  } catch {
    return undefined;
  }
}

function productApiIssuerSecret(): string | undefined {
  return envValue("AGENT_JOLA_KEY_ISSUER_SECRET", "AGENT_POPPY_KEY_ISSUER_SECRET") || undefined;
}

function normalizeProductApiScopes(scopes: unknown): ProductApiScope[] {
  const requested = new Set(
    Array.isArray(scopes) ? scopes.map((scope) => String(scope).trim()).filter(Boolean) : []
  );
  const normalized = ALL_PRODUCT_API_SCOPES.filter((scope) => requested.has(scope));
  return normalized.length > 0 ? normalized : ALL_PRODUCT_API_SCOPES;
}

function normalizeTtlSeconds(ttlSeconds: number | undefined): number | undefined {
  if (ttlSeconds === undefined) {
    return undefined;
  }
  return Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : undefined;
}

function cleanHandle(handle: string | undefined): string {
  const trimmed = handle?.trim().slice(0, 80);
  return trimmed || "local-agent";
}

function signPayload(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseQuotaEnv(
  value: string | undefined
): Partial<Record<ProductApiQuotaKey, number | null>> {
  if (!value?.trim()) {
    return {};
  }
  const quotas: Partial<Record<ProductApiQuotaKey, number | null>> = {};
  for (const entry of value.split(",")) {
    const [rawKey, rawLimit] = entry.split("=", 2);
    const key = rawKey?.trim() as ProductApiQuotaKey | undefined;
    if (!key || !(key in DEFAULT_PRODUCT_API_QUOTAS)) {
      continue;
    }
    const normalized = rawLimit?.trim().toLowerCase();
    if (
      !normalized ||
      normalized === "unlimited" ||
      normalized === "infinite" ||
      normalized === "none"
    ) {
      quotas[key] = null;
      continue;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      quotas[key] = Math.floor(parsed);
    }
  }
  return quotas;
}

function productApiKeyFromRequest(request: FastifyRequest): string | undefined {
  const direct =
    headerValue(request.headers[PRODUCT_API_KEY_HEADER]) ??
    headerValue(request.headers[LEGACY_PRODUCT_API_KEY_HEADER]);
  if (direct) {
    return direct.trim();
  }
  const authorization = headerValue(request.headers.authorization);
  if (!authorization) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim();
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function envValue(primary: string, legacy?: string): string {
  const value = process.env[primary]?.trim();
  if (value) {
    return value;
  }
  return legacy ? (process.env[legacy]?.trim() ?? "") : "";
}
