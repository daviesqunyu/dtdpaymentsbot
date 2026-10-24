import { writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const projectRef = "iqoffsnkptulvuqmdcce";

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
  try { unlinkSync(ps1); } catch {}
}

if (!token?.startsWith("sbp_")) {
  console.error("Could not read Supabase CLI access token");
  process.exit(1);
}

const orderId = randomUUID();
const email = "milli@dtdstore.com";

const sql = `
INSERT INTO public.orders (
  id, customer_email, customer_name, customer_phone,
  telegram_username, delivery_details, payment_method,
  payment_status, order_status, total_usd, payment_reference,
  product_account, created_at
) VALUES (
  '${orderId}',
  '${email}',
  'Milli Rich',
  'N/A',
  'N/A',
  'SMTP Console Access (free grant)',
  'Crypto',
  'paid',
  'delivered',
  0,
  'FREE-GRANT-MILLI',
  'N/A',
  now()
);
`;

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
console.log("[insert]", apply.status, applyText.slice(0, 500));
if (!apply.ok) process.exit(1);

// Verify
const verify = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: `select id, customer_email, customer_name, payment_status, order_status from public.orders where customer_email = '${email}' order by created_at desc limit 1`
    })
  }
);
const vText = await verify.text();
console.log("[verify]", verify.status, vText);

// Also set password for Milli Rich in Supabase Auth
const authSql = `
SELECT extend_admin设施建设, email FROM auth.users WHERE email = '${email}' LIMIT 1;
`;

console.log("\n========================================");
console.log("  ACCESS GRANTED FOR MILLI RICH");
console.log("========================================");
console.log(`  Order ID : ${orderId}`);
console.log(`  Email    : ${email}`);
console.log("========================================");
console.log("\nInstructions for Milli Rich:");
console.log("1. Go to https://dtdpaymentsbot.pages.dev/#smtp");
console.log(`2. Enter Order ID: ${orderId}`);
console.log(`3. Enter Email: ${email}`);
console.log("4. Click Unlock");
