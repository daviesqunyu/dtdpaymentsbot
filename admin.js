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
const refreshOrders = document.querySelector("#refreshOrders");
const cancelEdit = document.querySelector("#cancelEdit");
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
  resetProducts.disabled = !isEnabled;
  publishAllProducts.disabled = !isEnabled;
  refreshOrders.disabled = !isEnabled;
}

function clearForm() {
  productForm.reset();
  productForm.elements.id.value = "";
  productForm.elements.color.value = fallbackColor;
}

async function refreshAuth() {
  const { data } = await supabaseClient.auth.getUser();
  const user = data.user;

  if (!user) {
    authStatus.textContent = "Not signed in. Use your Supabase admin email and password.";
    loginForm.hidden = false;
    adminSessionBar.hidden = true;
    sessionEmail.textContent = "Signed in";
    setAdminEnabled(false);
    adminProductCount.textContent = "0 products";
    adminProducts.innerHTML = `<div class="empty-cart">Sign in to manage products.</div>`;
    adminOrders.innerHTML = `<div class="empty-cart">Sign in to check orders.</div>`;
    if (adminStats) adminStats.innerHTML = "";
    return;
  }

  authStatus.textContent = `Signed in as ${user.email}`;
  loginForm.hidden = true;
  adminSessionBar.hidden = false;
  sessionEmail.textContent = user.email;
  setAdminEnabled(true);
  await renderAdminProducts();
  await renderAdminOrders();
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

logoutButton.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  clearForm();
  showToast("Signed out");
  await refreshAuth();
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(productForm);
  const existingId = formData.get("id");
  const product = {
    name: formData.get("name").trim(),
    description: formData.get("description").trim(),
    price_usd: Number(formData.get("price")),
    color: formData.get("color") || fallbackColor,
    image_url: formData.get("imageUrl").trim() || null,
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

refreshAuth();
