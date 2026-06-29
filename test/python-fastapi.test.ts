// SPDX-License-Identifier: Apache-2.0
// FastAPI Detector 1 (Python) - the first end-to-end slice. Proves a vulnerable FastAPI route flags
// and the matched safe variants (limiter present, or no sensitive sink) stay clean.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { analyzePythonProject } from "../src/core/python/analyze.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tg-py-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const VULN_AUTH = `
from fastapi import APIRouter
from passlib.context import CryptContext

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"])

@router.post("/login")
async def login(body):
    user = get_user(body.email)
    if not pwd.verify(body.password, user.hash):
        raise ValueError()
    return {"ok": True}
`;

const SAFE_LIMITED = `
from fastapi import APIRouter
from passlib.context import CryptContext
from slowapi import Limiter

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"])
limiter = Limiter(key_func=None)

@router.post("/login")
@limiter.limit("5/minute")
async def login(request, body):
    pwd.verify(body.password, "x")
    return {"ok": True}
`;

const NON_SENSITIVE = `
from fastapi import APIRouter
router = APIRouter()

@router.get("/health")
def health():
    return {"ok": True}
`;

const LLM_MIXED = `
from fastapi import APIRouter, Depends
from openai import OpenAI

router = APIRouter()
client = OpenAI()

@router.post("/chat")
async def chat(body):
    return client.chat.completions.create(model="x", messages=[])

@router.post("/chat2", dependencies=[Depends(RateLimiter(times=5, seconds=60))])
async def chat2(body):
    return client.chat.completions.create(model="x", messages=[])
`;

describe("FastAPI Detector 1 (Python)", () => {
  it("flags an unprotected sensitive endpoint (auth sink, no limiter)", async () => {
    const dir = project({ "app/auth.py": VULN_AUTH });
    const findings = await analyzePythonProject(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("rate-limit/unprotected-sensitive-endpoint");
    expect(findings[0]?.sink).toBe("auth");
    expect(findings[0]?.file).toBe("app/auth.py");
  });

  it("does not flag a route covered by a slowapi limiter", async () => {
    const dir = project({ "app/auth.py": SAFE_LIMITED });
    expect(await analyzePythonProject(dir)).toHaveLength(0);
  });

  it("does not flag a non-sensitive route (no catalogued sink)", async () => {
    const dir = project({ "app/health.py": NON_SENSITIVE });
    expect(await analyzePythonProject(dir)).toHaveLength(0);
  });

  it("flags an LLM endpoint; a Depends(RateLimiter)-covered one stays clean", async () => {
    const dir = project({ "app/ai.py": LLM_MIXED });
    const findings = await analyzePythonProject(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sink).toBe("ai");
    expect(findings[0]?.message).toContain("/chat");
  });
});

// The real shape of FastAPI: the handler delegates across files to a service, which calls a
// security wrapper, which calls the sink. This is the moat - intraprocedural detection misses it.
const CHAIN_SERVICE = `from app.core.security import verify_password

class AuthService:
    async def login(self, email, password):
        return verify_password(password, "h")
`;
const CHAIN_SECURITY = `from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"])

def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)
`;

describe("FastAPI Detector 1 cross-file reachability (Python)", () => {
  it("flags a handler -> service method -> wrapper -> sink chain with no limiter", async () => {
    const dir = project({
      "app/api/auth.py": `from fastapi import APIRouter
from app.services.auth_service import AuthService
router = APIRouter()

@router.post("/login")
async def login(body):
    service = AuthService()
    return await service.login(body.email, body.password)
`,
      "app/services/auth_service.py": CHAIN_SERVICE,
      "app/core/security.py": CHAIN_SECURITY,
    });
    const findings = await analyzePythonProject(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe("app/api/auth.py");
    expect(findings[0]?.sink).toBe("auth");
  });

  it("does not flag the same chain when the route carries a slowapi limiter", async () => {
    const dir = project({
      "app/api/auth.py": `from fastapi import APIRouter
from slowapi import Limiter
from app.services.auth_service import AuthService
router = APIRouter()
limiter = Limiter(key_func=None)

@router.post("/login")
@limiter.limit("5/minute")
async def login(request, body):
    service = AuthService()
    return await service.login(body.email, body.password)
`,
      "app/services/auth_service.py": CHAIN_SERVICE,
      "app/core/security.py": CHAIN_SECURITY,
    });
    expect(await analyzePythonProject(dir)).toHaveLength(0);
  });

  it("does not flag any route when a global rate-limit middleware is applied (D061)", async () => {
    const dir = project({
      "app/main.py": `from fastapi import FastAPI, APIRouter
from passlib.context import CryptContext
from app.mw import GlobalRateLimitMiddleware

app = FastAPI()
app.add_middleware(GlobalRateLimitMiddleware)

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"])

@router.post("/login")
async def login(body):
    return pwd.verify(body.password, "h")
`,
    });
    expect(await analyzePythonProject(dir)).toHaveLength(0);
  });
});
