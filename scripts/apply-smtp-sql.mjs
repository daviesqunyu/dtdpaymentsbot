/**
 * Apply supabase-smtp-console.sql via Supabase Management API
 * (uses Supabase CLI token from Windows Credential Manager).
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const projectRef = "iqoffsnkptulvuqmdcce";
const sqlPath = new URL("../supabase-smtp-console.sql", import.meta.url);

const ps1 = join(tmpdir(), "get-sb-token.ps1");
writeFileSync(
  ps1,
  `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class CredSmtp {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static byte[] GetBytes(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] b = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
    CredFree(p);
    return b;
  }
}
'@
[Text.Encoding]::UTF8.GetString([CredSmtp]::GetBytes('Supabase CLI:supabase')).Trim()
`
);

let token;
try {
  token = execFileSync("powershell", ["-NoProfile", "-File", ps1], {
    encoding: "utf8"
  }).trim();
} finally {
  try {
    unlinkSync(ps1);
  } catch {
    /* ignore */
  }
}

if (!token?.startsWith("sbp_")) {
  console.error("Could not read Supabase CLI access token");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const apply = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: sql })
  }
);
const applyText = await apply.text();
console.log("[apply]", apply.status, applyText.slice(0, 500));
if (!apply.ok) process.exit(1);

const verify = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query:
        "select to_regclass('public.smtp_jobs')::text as jobs, to_regclass('public.smtp_access')::text as access, to_regclass('public.smtp_job_recipients')::text as recipients"
    })
  }
);
console.log("[verify]", verify.status, await verify.text());
