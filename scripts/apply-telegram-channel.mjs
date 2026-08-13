/**
 * Apply supabase-smtp-telegram.sql via Management API
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const projectRef = "iqoffsnkptulvuqmdcce";
const ps1 = join(tmpdir(), "get-sb-token2.ps1");
writeFileSync(
  ps1,
  `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class CredTg {
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
[Text.Encoding]::UTF8.GetString([CredTg]::GetBytes('Supabase CLI:supabase')).Trim()
`
);

let token;
try {
  token = execFileSync("powershell", ["-NoProfile", "-File", ps1], { encoding: "utf8" }).trim();
} finally {
  try {
    unlinkSync(ps1);
  } catch {
    /* ignore */
  }
}

const sql = readFileSync(new URL("../supabase-smtp-telegram.sql", import.meta.url), "utf8");
const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql })
});
console.log("[apply]", res.status, await res.text());
if (!res.ok) process.exit(1);
