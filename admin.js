const fallbackColor = "#0f766e";

const productForm = document.querySelector("#productForm");
const loginForm = document.querySelector("#loginForm");
const logoutButton = document.querySelector("#logoutButton");
const authStatus = document.querySelector("#authStatus");
const adminSessionBar = document.querySelector("#adminSessionBar");
const sessionEmail = document.querySelector("#sessionEmail");
const adminProducts = document.querySelector("#adminProducts");
const adminProductCount = document.querySelector("#adminProductCount");
const adminOrders = document.querySelector("#adminOrders");
const mmshopForm = document.querySelector("#mmshopForm");
const mmshopCatalogList = document.querySelector("#mmshopCatalogList");
const mmshopCatalogCount = document.querySelector("#mmshopCatalogCount");
const refreshOrders = document.querySelector("#refreshOrders");
const cancelEdit = document.querySelector("#cancelEdit");
const cancelMmshopEdit = document.querySelector("#cancelMmshopEdit");
const resetProducts = document.querySelector("#resetProducts");
const publishAllProducts = document.querySelector("#publishAllProducts");
const copyLiveLink = document.querySelector("#copyLiveLink");
const adminStats = document.querySelector("#adminStats");
const toast = document.querySelector("#toast");

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function inlineProductImage(title, subtitle, background, accent) {
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${background}"/>
          <stop offset="1" stop-color="#111827"/>
        </linearGradient>
      </defs>
      <rect width="900" height="620" rx="34" fill="url(#bg)"/>
      <circle cx="734" cy="120" r="92" fill="${accent}" opacity=".24"/>
      <circle cx="118" cy="505" r="135" fill="#fff" opacity=".09"/>
      <rect x="96" y="92" width="708" height="436" rx="28" fill="#fff" opacity=".1"/>
      <rect x="140" y="142" width="220" height="28" rx="14" fill="#fff" opacity=".52"/>
      <rect x="140" y="204" width="620" height="8" rx="4" fill="${accent}"/>
      <rect x="140" y="252" width="288" height="154" rx="22" fill="#fff" opacity=".14"/>
      <rect x="460" y="252" width="300" height="154" rx="22" fill="#fff" opacity=".14"/>
      <path d="M234 334h96m-48-48v96" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
      <path d="M560 338l48 48 82-108" fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="140" y="472" fill="#fff" font-family="Inter,Arial,sans-serif" font-size="50" font-weight="800">${title}</text>
      <text x="140" y="515" fill="#d1d5db" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="600">${subtitle}</text>
    </svg>
  `)}`;
}

const sampleProducts = [
  {
    name: "Automation Bot Builder",
    description: "A ready setup package for simple workflow bots, auto replies, and order notifications.",
    price_usd: 49,
    color: fallbackColor,
    image_url: inlineProductImage("Bot Builder", "Automation setup", "#0f766e", "#f59e0b"),
    active: true
  },
  {
    name: "Customer Support Bot",
    description: "A support bot package for FAQs, customer intake, and clean handoff to your team.",
    price_usd: 79,
    color: "#2563eb",
    image_url: inlineProductImage("Support Bot", "FAQ and intake", "#2563eb", "#22c55e"),
    active: true
  },
  {
    name: "Analytics Dashboard Kit",
    description: "A lightweight dashboard product for tracking sales, orders, and customer activity.",
    price_usd: 129,
    color: "#7c2d12",
    image_url: inlineProductImage("Dashboard Kit", "Sales analytics", "#7c2d12", "#38bdf8"),
    active: true
  }
];

const MM_SHOP_CATALOG_KEY = "dtd_mmshop_catalog_v1";

function defaultMmshopRows() {
  return [
    { id: crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}-1`, cc: "1", name: "", details: "", product: "" },
    { id: crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}-2`, cc: "2", name: "", details: "", product: "" },
    { id: crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}-3`, cc: "3", name: "", details: "", product: "" },
    { id: crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}-4`, cc: "4", name: "", details: "", product: "" }
  ];
}

function loadMmshopRows() {
  try {
    const raw = localStorage.getItem(MM_SHOP_CATALOG_KEY);
    if (!raw) return defaultMmshopRows();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return defaultMmshopRows();
    return parsed;
  } catch {
    return defaultMmshopRows();
  }
}

function saveMmshopRows(rows) {
  try {
    localStorage.setItem(MM_SHOP_CATALOG_KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

function renderMmshopCatalogList() {
  if (!mmshopCatalogList) return;

  const rows = loadMmshopRows();
  mmshopCatalogCount.textContent = `${rows.filter((row) => row.name || row.details || row.product).length} rows`;

  if (!rows.length) {
    mmshopCatalogList.innerHTML = '<div class="empty-cart">No DTDSHOP.CC entries yet.</div>';
    return;
  }

  mmshopCatalogList.innerHTML = rows
    .map(
      (row) => `
        <article class="admin-product">
          <div>
            <h3>CC ${row.cc || ""}</h3>
            <p><strong>Name:</strong> ${row.name || "—"}</p>
            <p><strong>Details:</strong> ${row.details || "—"}</p>
            <p><strong>Product:</strong> ${row.product || "—"}</p>
          </div>
          <div class="admin-card-actions">
            <button type="button" class="secondary-button" data-mmshop-edit="${row.id}">Edit</button>
            <button type="button" class="danger-button" data-mmshop-delete="${row.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function clearMmshopForm() {
  if (!mmshopForm) return;
  mmshopForm.reset();
  mmshopForm.elements.id.value = "";
}

function formatDate(value) {
  if (!value) return "Unknown date";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function paymentStatusClass(status) {
  return status === "paid" ? "payment-paid" : "payment-pending";
}

function orderStatusClass(status) {
  if (status === "delivered") return "order-delivered";
  if (status === "cancelled") return "order-cancelled";
  return "hidden";
}

async function renderAdminStats(products = [], orders = []) {
  if (!adminStats) return;

  const visibleProducts = products.filter((product) => product.active).length;
  const pendingOrders = orders.filter(
    (order) => order.payment_status !== "paid" || order.order_status === "pending"
  ).length;

  adminStats.innerHTML = `
    <span class="admin-stat-pill">${visibleProducts} visible products</span>
    <span class="admin-stat-pill">${products.length} total products</span>
    <span class="admin-stat-pill">${pendingOrders} pending orders</span>
    <span class="admin-stat-pill">${orders.length} recent orders</span>
  `;
}

function formatMoney(value) {
  return formatter.format(Number(value || 0));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2200);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Copy failed. Use the browser address instead.");
  }
}

function setAdminEnabled(isEnabled) {
  productForm.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !isEnabled;
  });
  if (resetProducts) resetProducts.disabled = !isEnabled;
  if (publishAllProducts) publishAllProducts.disabled = !isEnabled;
  if (refreshOrders) refreshOrders.disabled = !isEnabled;
}

const ADMIN_TITLES = {
  overview: "Overview",
  products: "Products",
  orders: "Orders",
  login: "Sign in"
};

function showAdminPage(pageId) {
  const signedIn = !loginForm || loginForm.hidden;
  let id = pageId;
  if (!signedIn) id = "login";
  if (signedIn && id === "login") id = "overview";

  document.querySelectorAll(".admin-page").forEach((page) => {
    const active = page.dataset.adminPage === id;
    page.hidden = !active;
    page.classList.toggle("is-active", active);
  });

  document.querySelectorAll("[data-admin-page]").forEach((el) => {
    if (el.tagName === "SECTION") return;
    el.classList.toggle("is-active", el.getAttribute("data-admin-page") === id);
  });

  const titleEl = document.querySelector("#adminShellTitle");
  if (titleEl) titleEl.textContent = ADMIN_TITLES[id] || "Admin";

  setAdminNavOpen(false);
}

function setAdminNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  const backdrop = document.querySelector("#navBackdrop");
  const toggle = document.querySelector("#navToggle");
  const label = toggle?.querySelector(".nav-toggle-text");
  if (backdrop) backdrop.hidden = !open;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  if (label) label.textContent = open ? "Close" : "Menu";
}

function bindAdminShell() {
  document.querySelectorAll("[data-admin-page]").forEach((el) => {
    if (el.tagName === "SECTION") return;
    el.addEventListener("click", () => {
      const page = el.getAttribute("data-admin-page");
      if (page) showAdminPage(page);
    });
  });

  const toggle = document.querySelector("#navToggle");
  const backdrop = document.querySelector("#navBackdrop");
  if (toggle) {
    toggle.addEventListener("click", () => setAdminNavOpen(!document.body.classList.contains("nav-open")));
  }
  if (backdrop) {
    backdrop.addEventListener("click", () => setAdminNavOpen(false));
  }
  document.querySelectorAll("[data-nav-close]").forEach((btn) => {
    btn.addEventListener("click", () => setAdminNavOpen(false));
  });
}

function clearForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  productForm.elements.color.value = fallbackColor;
  const preview = document.querySelector("#productImagePreview");
  const status = document.querySelector("#productImageStatus");
  const file = document.querySelector("#productImageFile");
  if (preview) {
    preview.removeAttribute("src");
    preview.classList.remove("is-on");
  }
  if (status) status.textContent = "";
  if (file) file.value = "";
}

async function refreshAuth() {
  const { data } = await supabaseClient.auth.getUser();
  const user = data.user;

  if (!user) {
    authStatus.textContent = "Not signed in. Use your Supabase admin email and password.";
    loginForm.hidden = false;
    if (adminSessionBar) adminSessionBar.hidden = true;
    if (logoutButton) logoutButton.hidden = true;
    sessionEmail.textContent = "Signed in";
    setAdminEnabled(false);
    adminProductCount.textContent = "0 products";
    adminProducts.innerHTML = `<div class="empty-cart">Sign in to manage products.</div>`;
    adminOrders.innerHTML = `<div class="empty-cart">Sign in to check orders.</div>`;
    if (adminStats) adminStats.innerHTML = "";
    showAdminPage("login");
    return;
  }

  authStatus.textContent = `Signed in as ${user.email}`;
  loginForm.hidden = true;
  if (adminSessionBar) adminSessionBar.hidden = false;
  if (logoutButton) logoutButton.hidden = false;
  sessionEmail.textContent = user.email;
  setAdminEnabled(true);
  await renderAdminProducts();
  await renderAdminOrders();
  showAdminPage("overview");
}

async function loadAdminOrders() {
  const { data: orders, error } = await supabaseClient
    .from("orders")
    .select(
      "id,customer_name,customer_email,telegram_username,delivery_details,payment_method,payment_reference,product_account,payment_status,order_status,total_usd,created_at,order_items(product_name,quantity,unit_price_usd)"
    )
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) throw error;
  return orders || [];
}

function renderOrderBadges(order) {
  return `
    <span class="status-pill ${paymentStatusClass(order.payment_status)}">${order.payment_status}</span>
    <span class="status-pill ${orderStatusClass(order.order_status)}">${order.order_status}</span>
  `;
}

async function renderAdminOrders() {
  adminOrders.innerHTML = `<div class="empty-cart">Loading orders...</div>`;

  let orders = [];
  try {
    orders = await loadAdminOrders();
  } catch (error) {
    console.error(error);
    adminOrders.innerHTML = `<div class="empty-cart">Could not load orders. Run the admin order SQL policy update.</div>`;
    return;
  }

  const { data: products } = await supabaseClient
    .from("products")
    .select("id,active")
    .order("created_at", { ascending: false });
  await renderAdminStats(products || [], orders);

  if (!orders.length) {
    adminOrders.innerHTML = `<div class="empty-cart">No orders yet.</div>`;
    return;
  }

  adminOrders.innerHTML = orders
    .map((order) => {
      const items = order.order_items
        .map((item) => `${item.product_name} x${item.quantity} (${formatMoney(item.unit_price_usd)})`)
        .join(", ");
      const telegramLine = order.telegram_username
        ? `<p>Telegram: @${String(order.telegram_username).replace(/^@/, "")}</p>`
        : "";

      return `
        <article class="admin-order">
          <div>
            <div class="order-topline">
              <strong>${order.customer_name}</strong>
              ${renderOrderBadges(order)}
            </div>
            <p class="order-date">${formatDate(order.created_at)}</p>
            <p>${items}</p>
            <p><strong>${formatMoney(order.total_usd)}</strong> via ${order.payment_method}</p>
            <p>${order.customer_email || "No email"}${order.payment_reference ? ` / Ref: ${order.payment_reference}` : ""}</p>
            ${telegramLine}
            ${order.product_account ? `<p>Account: ${order.product_account}</p>` : ""}
            <pre>${order.delivery_details}</pre>
          </div>
          <div class="admin-card-actions">
            <button type="button" class="secondary-button" data-paid="${order.id}">Mark paid</button>
            <button type="button" class="secondary-button" data-delivered="${order.id}">Delivered</button>
            <button type="button" class="danger-button" data-cancel="${order.id}">Cancel</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function renderAdminProducts() {
  adminProducts.innerHTML = `<div class="empty-cart">Loading products...</div>`;

  const { data: products, error } = await supabaseClient
    .from("products")
    .select("id,name,description,price_usd,color,image_url,active")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    adminProductCount.textContent = "0 products";
    adminProducts.innerHTML = `<div class="empty-cart">Could not load products. Check admin RLS setup.</div>`;
    return;
  }

  const visibleCount = products.filter((product) => product.active).length;
  adminProductCount.textContent = `${visibleCount}/${products.length} visible`;

  let orders = [];
  try {
    orders = await loadAdminOrders();
  } catch {
    orders = [];
  }
  await renderAdminStats(products, orders);

  if (!products.length) {
    adminProducts.innerHTML = `<div class="empty-cart">No products yet. Add the first one on the left.</div>`;
    return;
  }

  adminProducts.innerHTML = products
    .map(
      (product) => `
        <article class="admin-product">
          <span class="product-dot" style="background:${product.color || fallbackColor}">
            ${product.image_url ? `<img src="${product.image_url}" alt="" />` : ""}
          </span>
          <div>
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <strong>${formatMoney(product.price_usd)}</strong>
            <span class="status-pill ${product.active ? "active" : "hidden"}">
              ${product.active ? "Visible" : "Hidden"}
            </span>
          </div>
          <div class="admin-card-actions">
            <button type="button" class="secondary-button" data-toggle="${product.id}" data-active="${product.active}">
              ${product.active ? "Hide" : "Show"}
            </button>
            <button type="button" class="secondary-button" data-edit="${product.id}">Edit</button>
            <button type="button" class="danger-button" data-delete="${product.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (error) {
    console.error(error);
    showToast("Login failed. Check email and password.");
    return;
  }

  loginForm.reset();
  showToast("Signed in");
  await refreshAuth();
});

logoutButton?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  clearForm();
  showToast("Signed out");
  await refreshAuth();
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(productForm);
  const existingId = formData.get("id");
  const status = document.querySelector("#productImageStatus");
  let imageUrl = String(formData.get("imageUrl") || "").trim() || null;

  const fileInput = document.querySelector("#productImageFile");
  const file = fileInput?.files?.[0];
  if (file) {
    try {
      if (status) status.textContent = "Uploading image…";
      imageUrl = await uploadProductImage(file);
      if (productForm.elements.imageUrl) productForm.elements.imageUrl.value = imageUrl;
      if (status) status.textContent = "Image uploaded.";
    } catch (err) {
      if (status) status.textContent = err.message || "Upload failed.";
      showToast(err.message || "Image upload failed.");
      return;
    }
  }

  const product = {
    name: formData.get("name").trim(),
    description: formData.get("description").trim(),
    price_usd: Number(formData.get("price")),
    color: formData.get("color") || fallbackColor,
    image_url: imageUrl,
    active: formData.get("active") === "true"
  };

  const request = existingId
    ? supabaseClient.from("products").update(product).eq("id", existingId)
    : supabaseClient.from("products").insert(product);

  const { error } = await request;

  if (error) {
    console.error(error);
    showToast("Product not saved. Check admin access.");
    return;
  }

  clearForm();
  await renderAdminProducts();
  showToast(existingId ? "Product updated" : "Product added");
});

async function uploadProductImage(file) {
  const session = (await supabaseClient.auth.getSession()).data.session;
  const token = session?.access_token;
  if (!token) throw new Error("Sign in as admin first.");

  const dataUrl = await readFileAsDataUrl(file);
  const resp = await fetch("/api/products/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ dataUrl, contentType: file.type || "image/jpeg" })
  });
  const payload = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(payload.error || "Upload failed.");
  return payload.url;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

document.querySelector("#productImageFile")?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  const preview = document.querySelector("#productImagePreview");
  const status = document.querySelector("#productImageStatus");
  if (!file || !preview) return;
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.classList.add("is-on");
  if (status) status.textContent = `${file.name} ready — will upload on Save.`;
});

adminProducts.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit]");
  const deleteButton = event.target.closest("[data-delete]");
  const toggleButton = event.target.closest("[data-toggle]");

  if (toggleButton) {
    const nextActive = toggleButton.dataset.active !== "true";
    const { error } = await supabaseClient
      .from("products")
      .update({ active: nextActive })
      .eq("id", toggleButton.dataset.toggle);

    if (error) {
      console.error(error);
      showToast("Could not update visibility.");
      return;
    }

    await renderAdminProducts();
    showToast(nextActive ? "Product is now visible" : "Product hidden");
    return;
  }

  if (editButton) {
    const { data: product, error } = await supabaseClient
      .from("products")
      .select("id,name,description,price_usd,color,image_url,active")
      .eq("id", editButton.dataset.edit)
      .single();

    if (error) {
      console.error(error);
      showToast("Could not load product.");
      return;
    }

    productForm.elements.id.value = product.id;
    productForm.elements.name.value = product.name;
    productForm.elements.price.value = product.price_usd;
    productForm.elements.description.value = product.description;
    productForm.elements.color.value = product.color || fallbackColor;
    productForm.elements.imageUrl.value = product.image_url || "";
    productForm.elements.active.value = String(product.active);
    showAdminPage("products");
    productForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (deleteButton) {
    const { error } = await supabaseClient.from("products").delete().eq("id", deleteButton.dataset.delete);

    if (error) {
      console.error(error);
      showToast("Product not deleted. Check admin access.");
      return;
    }

    await renderAdminProducts();
    showToast("Product deleted");
  }
});

adminOrders.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-paid], button[data-delivered], button[data-cancel]");
  if (!button || button.disabled) return;

  const paidButton = event.target.closest("[data-paid]");
  const deliveredButton = event.target.closest("[data-delivered]");
  const cancelButton = event.target.closest("[data-cancel]");

  let update = null;
  let id = null;

  if (paidButton) {
    id = paidButton.dataset.paid;
    update = { payment_status: "paid", order_status: "confirmed" };
  }

  if (deliveredButton) {
    id = deliveredButton.dataset.delivered;
    update = { payment_status: "paid", order_status: "delivered" };
  }

  if (cancelButton) {
    id = cancelButton.dataset.cancel;
    update = { order_status: "cancelled" };
  }

  if (!update) return;

  const actionButtons = adminOrders.querySelectorAll("button");
  actionButtons.forEach((item) => {
    item.disabled = true;
  });
  button.textContent = "Saving...";

  const { error } = await supabaseClient.from("orders").update(update).eq("id", id);

  if (error) {
    console.error(error);
    showToast("Order update failed. Run the admin order SQL policy update.");
    await renderAdminOrders();
    return;
  }

  await renderAdminOrders();
  showToast("Order updated");
});

cancelEdit.addEventListener("click", clearForm);
cancelMmshopEdit?.addEventListener("click", clearMmshopForm);

mmshopForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(mmshopForm);
  const rows = loadMmshopRows();
  const payload = {
    id: String(formData.get("id") || crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}`),
    cc: String(formData.get("cc") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    details: String(formData.get("details") || "").trim(),
    product: String(formData.get("product") || "").trim()
  };

  if (!payload.cc || !payload.name || !payload.details || !payload.product) {
    showToast("Fill in CC, name, details, and product.");
    return;
  }

  const idx = rows.findIndex((row) => row.id === formData.get("id"));
  if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
  else rows.push(payload);

  saveMmshopRows(rows);
  renderMmshopCatalogList();
  clearMmshopForm();
  showToast("DTDSHOP.CC row saved");
});

mmshopCatalogList?.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-mmshop-edit]");
  const deleteButton = event.target.closest("[data-mmshop-delete]");

  if (editButton) {
    const rows = loadMmshopRows();
    const item = rows.find((row) => row.id === editButton.dataset.mmshopEdit);
    if (!item) return;
    mmshopForm.elements.id.value = item.id;
    mmshopForm.elements.cc.value = item.cc || "";
    mmshopForm.elements.name.value = item.name || "";
    mmshopForm.elements.details.value = item.details || "";
    mmshopForm.elements.product.value = item.product || "";
    mmshopForm.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (deleteButton) {
    const rows = loadMmshopRows().filter((row) => row.id !== deleteButton.dataset.mmshopDelete);
    saveMmshopRows(rows);
    renderMmshopCatalogList();
    showToast("DTDSHOP.CC row deleted");
  }
});

renderMmshopCatalogList();

resetProducts.addEventListener("click", async () => {
  const { error } = await supabaseClient.from("products").insert(sampleProducts);

  if (error) {
    console.error(error);
    showToast("Samples not added. Check admin access.");
    return;
  }

  clearForm();
  await renderAdminProducts();
  showToast("Sample products added");
});

publishAllProducts.addEventListener("click", async () => {
  const { error } = await supabaseClient.from("products").update({ active: true }).neq("active", true);

  if (error) {
    console.error(error);
    showToast("Could not publish products. Check admin access.");
    return;
  }

  await renderAdminProducts();
  showToast("All products are visible to users");
});

copyLiveLink.addEventListener("click", () => {
  const storeUrl = window.location.origin.replace(/\/admin\.html$/, "") || window.location.origin;
  copyText(storeUrl.endsWith("/") ? storeUrl.slice(0, -1) : storeUrl, "Live store link copied");
});

refreshOrders.addEventListener("click", renderAdminOrders);

bindAdminShell();
refreshAuth();
