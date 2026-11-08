// Use the Express backend when the page is opened by VS Code Live Server
// (usually localhost:5500) instead of the app server at localhost:5000.
const isLocalPreview = ["localhost", "127.0.0.1"].includes(
  window.location.hostname
);
const API_BASE =
  isLocalPreview && window.location.port !== "5000"
    ? `http://${window.location.hostname}:5000/api`
    : "/api";

const TOKEN_KEY = "portal_token";
const USER_KEY = "portal_user";

let currentUser = getSavedUser();
let loginRole = ({
  "/admin-login": "admin",
  "/department-login": "department",
  "/student-login": "student"
})[window.location.pathname] || "student";
let adminChart = null;
let adminDepartmentChart = null;
let adminTrendChart = null;
const departmentCodes = ["CSE", "AIML", "CIVIL", "EC", "MECHANICAL"];
let departments = [...departmentCodes];
let adminUsersById = new Map();

const portalConfig = {
  student: {
    path: "/student-login",
    label: "BGMIT STUDENT PORTAL",
    title: "Student Complaint Portal",
    description: "Sign in to report, track and manage your own campus complaints.",
    emailPlaceholder: "student@example.com"
  },
  admin: {
    path: "/admin-login",
    label: "BGMIT ADMINISTRATOR PORTAL",
    title: "Administrator Portal",
    description: "Secure access for college-wide complaint management and administration.",
    emailPlaceholder: "admin@yourcollege.edu"
  },
  department: {
    path: "/department-login",
    label: "BGMIT DEPARTMENT STAFF PORTAL",
    title: "Department Staff Portal",
    description: "Sign in to manage complaints assigned to your department only.",
    emailPlaceholder: "department@yourcollege.edu"
  }
};

// Read saved user safely.
function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

// Shortcut for selecting HTML elements.
function $(selector) {
  return document.querySelector(selector);
}

// Stop unsafe text from becoming HTML.
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

// Show green/red message at bottom of screen.
function showToast(message, type = "success") {
  let toast = $("#toast");

  if (!toast) {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="toast" class="toast" aria-live="polite"></div>'
    );

    toast = $("#toast");
  }

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  clearTimeout(window.toastTimer);

  window.toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 4000);
}

// Call Express backend API.
async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const settings = {
    method: options.method || "GET",
    headers: {}
  };

  if (token) {
    settings.headers.Authorization = `Bearer ${token}`;
  }

  if (options.body instanceof FormData) {
    settings.body = options.body;
  } else if (options.body) {
    settings.headers["Content-Type"] = "application/json";
    settings.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, settings);
  } catch {
    throw new Error(
      "Cannot reach the portal server. Run npm run dev, wait for ‘Portal running at http://localhost:5000’, then open that address."
    );
  }

  const responseText = await response.text();
  let data = {};

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    // A static preview server can return an HTML page instead of API JSON.
    data = {};
  }

  if (!response.ok) {
    if (data.message) {
      throw new Error(data.message);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        "The login request reached a preview page instead of the portal API. Keep npm run dev running and open http://localhost:5000."
      );
    }

    throw new Error(`The portal request failed (HTTP ${response.status}).`);
  }

  return data;
}

// Check if user is Admin or Department staff.
function isStaff() {
  return (
    currentUser &&
    (currentUser.role === "admin" ||
      currentUser.role === "department")
  );
}

function loginEndpoint() {
  return loginRole === "admin" ? "/auth/admin/login" : loginRole === "department" ? "/auth/department/login" : "/auth/student/login";
}

function openPortalLogin(role = "student") {
  loginRole = portalConfig[role] ? role : "student";
  const path = portalConfig[loginRole].path;

  if (window.location.pathname !== path) {
    window.history.pushState({}, "", `${path}#login`);
  }

  configureLoginPortal();
  showPage("login", false);
}

// A login URL is tied to one role. The backend independently checks that role,
// so a Department account can never be used on the Administrator portal.
function configureLoginPortal() {
  const config = portalConfig[loginRole] || portalConfig.student;
  const heading = $("#loginTitle");
  const label = $("#loginPortalLabel");
  const description = $("#loginDescription");
  const email = $("#loginEmail");
  const registerButton = $("#openRegisterButton");
  const loginTabs = $(".login-tabs");

  if (heading) heading.textContent = config.title;
  if (label) label.textContent = config.label;
  if (description) description.textContent = config.description;
  if (email) email.placeholder = config.emailPlaceholder;
  if (loginTabs) loginTabs.remove();

  if (registerButton) {
    registerButton.hidden = loginRole !== "student";
  }
}

// Save successful login in browser.
function saveSession(data) {
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));

  currentUser = data.user;

  updateHeader();
}

// Remove login session.
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);

  currentUser = null;

  updateHeader();

  showToast("You have logged out successfully.");

  showPage("home");
}

// Change Login button into Dashboard button after login.
function updateHeader() {
  const loginButton = $(".nav-login");

  if (!loginButton) return;

  if (currentUser) {
    loginButton.textContent = currentUser.role === "admin"
      ? "Admin Dashboard"
      : currentUser.role === "department"
        ? "Department Dashboard"
        : "My Dashboard";

    loginButton.dataset.page = currentUser.role === "admin"
      ? "admin"
      : currentUser.role === "department"
        ? "department"
        : "dashboard";
    delete loginButton.dataset.portalLogin;
  } else {
    loginButton.textContent = "Login";
    loginButton.dataset.page = "portal-choice";
    delete loginButton.dataset.portalLogin;
  }
}

// Show selected frontend page.
function showPage(pageName, updateHash = true) {
  const protectedPages = [
    "dashboard",
    "complaint",
    "admin",
    "department",
    "track"
  ];

  // Send each authenticated role to its own distinct portal, never the
  // shared/merged staff page used by the old version.
  if (pageName === "dashboard" && currentUser) {
    pageName = currentUser.role === "admin"
      ? "admin"
      : currentUser.role === "department"
        ? "department"
        : "dashboard";
  }

  if (protectedPages.includes(pageName) && !currentUser) {
    showToast("Please log in first.", "error");
    pageName = "login";
  }

  if (pageName === "admin" && (!currentUser || currentUser.role !== "admin")) {
    showToast("Administrator login is required.", "error");
    pageName = "login";
  }

  if (pageName === "department" && (!currentUser || currentUser.role !== "department")) {
    showToast("Department staff login is required.", "error");
    pageName = "login";
  }

  if (pageName === "track" && (!currentUser || currentUser.role !== "student")) {
    showToast("Student login is required to track a complaint.", "error");
    pageName = "login";
  }

  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active-page");
  });

  const targetPage = document.getElementById(
    `${pageName}Page`
  );

  if (targetPage) {
    targetPage.classList.add("active-page");
  }

  document.querySelectorAll(".main-nav a").forEach((link) => {
    link.classList.remove("active");

    if (link.dataset.page === pageName) {
      link.classList.add("active");
    }
  });

  if (updateHash) {
    const destination =
      pageName === "about"
        ? "/about"
        : pageName === "home"
          ? "/"
          : `/#${pageName}`;
    history.pushState(null, "", destination);
  }

  $("#mainNav")?.classList.remove("open");

  window.scrollTo(0, 0);

  if (pageName === "dashboard") {
    loadStudentDashboard();
  }

  if (pageName === "admin") {
    loadAdminDashboard();
  }

  if (pageName === "department") {
    loadDepartmentDashboard();
  }

  if (pageName === "complaint") {
    loadCategories();
    toggleBusFields();
  }
}

// Insert Register and role-specific dashboard pages automatically.
function createExtraPages() {
  const main = $("main");

  if (!$("#registerPage")) {
    main.insertAdjacentHTML(
      "beforeend",
      `
      <section class="page auth-page" id="registerPage">
        <div class="auth-card">
          <button class="back-button" data-page="login">
            <i class="fa-solid fa-arrow-left"></i> Back to Login
          </button>

          <div class="auth-logo">
            <i class="fa-solid fa-user-plus"></i>
          </div>

          <h1>Create Student Account</h1>
          <p>Register once to submit and track campus complaints.</p>

          <form id="registerForm">
            <label for="registerName">Full Name</label>
            <input id="registerName" required placeholder="Enter full name">

            <label for="registerEmail">Email Address</label>
            <input id="registerEmail" type="email" required placeholder="student@example.com">

            <label for="registerUsn">USN</label>
            <input id="registerUsn" required placeholder="Example: 4BG21CS001">

            <label for="registerDepartment">Branch / Department</label>
            <select id="registerDepartment" required>
              <option value="">Select department</option><option>CSE</option><option>AIML</option><option>CIVIL</option><option>EC</option><option>MECHANICAL</option>
            </select>

            <label for="registerSemester">Semester</label>
            <select id="registerSemester" required>
              <option value="">Select semester</option>
              <option>1</option>
              <option>2</option>
              <option>3</option>
              <option>4</option>
              <option>5</option>
              <option>6</option>
              <option>7</option>
              <option>8</option>
            </select>

            <label for="registerPassword">Password</label>
            <input id="registerPassword" type="password" required minlength="6" placeholder="Minimum 6 characters">

            <button class="button button-primary full-button" type="submit">
              Create Account <i class="fa-solid fa-arrow-right"></i>
            </button>
          </form>
        </div>
      </section>
      `
    );
  }

  if (!$("#adminPage")) {
    main.insertAdjacentHTML(
      "beforeend",
      `
      <section class="page admin-page" id="adminPage">
        <div class="admin-shell">
          <button class="back-button" data-page="home">
            <i class="fa-solid fa-arrow-left"></i> Back to Home
          </button>

          <div class="portal-role-nav" aria-label="Administrator navigation">
            <button class="portal-nav-link active" data-page="admin"><i class="fa-solid fa-gauge-high"></i> Dashboard</button>
            <button class="portal-nav-link" data-admin-scroll="adminComplaintRows"><i class="fa-solid fa-layer-group"></i> All Complaints</button>
            <button class="portal-nav-link" data-admin-action="departments"><i class="fa-solid fa-building-columns"></i> Departments</button>
            <button class="portal-nav-link" data-admin-action="management"><i class="fa-solid fa-sliders"></i> Complaint Management</button>
            <button class="portal-nav-link" data-admin-scroll="adminCategoryChart"><i class="fa-solid fa-chart-line"></i> Reports & Analytics</button>
            <button class="portal-nav-link" data-admin-action="notifications"><i class="fa-solid fa-bell"></i> Notifications</button>
            <button class="portal-nav-link" data-profile><i class="fa-solid fa-id-badge"></i> Profile</button>
            <button class="portal-nav-link logout-button" data-page="home"><i class="fa-solid fa-arrow-right-from-bracket"></i> Logout</button>
          </div>

          <div class="admin-heading">
            <div>
              <p class="small-title">ADMINISTRATOR PORTAL</p>
              <h1>College Administration Dashboard</h1>
              <p id="adminWelcome">Manage, assign and resolve campus complaints.</p>
            </div>

            <div class="admin-report-actions">
              <button id="downloadCsvButton" class="button button-primary" title="Open the report in Microsoft Excel, Google Sheets, or LibreOffice">
                <i class="fa-solid fa-file-excel"></i> Export Excel
              </button>
              <button id="printAdminReportButton" class="button button-light" title="Use your browser's Save as PDF option">
                <i class="fa-solid fa-print"></i> Official Print Centre
              </button>
            </div>
          </div>

          <div class="admin-stat-grid" id="adminStats"></div>

          <div class="admin-filter-row">
            <input id="adminSearch" placeholder="Search ticket, title or location">

            <select id="adminDepartmentFilter">
              <option value="">All departments</option>
              ${departmentCodes.map((department) => `<option value="${department}">${department}</option>`).join("")}
              <option value="ADMIN">Administration only</option>
            </select>

            <select id="adminStatusFilter">
              <option value="">All Statuses</option>
              <option>Submitted</option>
              <option>Assigned</option>
              <option>In Progress</option>
              <option>Resolved</option>
              <option>Closed</option>
              <option>Reopened</option>
              <option>Rejected</option>
            </select>

            <select id="adminPriorityFilter">
              <option value="">All Priorities</option>
              <option>Low</option>
              <option>Normal</option>
              <option>High</option>
              <option>Emergency</option>
            </select>

            <select id="adminDueFilter">
              <option value="">All deadlines</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="upcoming">Upcoming (7 days)</option>
              <option value="resolved">Resolved</option>
            </select>

            <label class="date-filter"><span>From</span><input id="adminFromDate" type="date"></label>
            <label class="date-filter"><span>To</span><input id="adminToDate" type="date"></label>
            <select id="adminTrendGranularity" title="Choose analytics trend grouping">
              <option value="month">Monthly trend</option>
              <option value="week">Weekly trend</option>
              <option value="day">Daily trend</option>
            </select>

            <button id="applyAdminFilters" class="button button-primary">
              Apply filters
            </button>
          </div>

          <div class="admin-layout">
            <section class="admin-panel">
              <h2>Complaint Queue</h2>

              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Title</th>
                      <th>Department</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th>Due Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody id="adminComplaintRows"></tbody>
                </table>
              </div>
            </section>

            <aside class="admin-panel" id="managePanel">
              <h2>Manage Complaint</h2>
              <p class="empty-state">
                Click Manage beside a complaint to assign a department or update its status.
              </p>
            </aside>
          </div>

          <section class="analytics-grid" aria-label="Complaint analytics">
            <article class="chart-card">
              <div class="analytics-card-heading"><div><p class="small-title">FREQUENTLY REPORTED</p><h3>Complaints by category</h3></div><i class="fa-solid fa-chart-column"></i></div>
              <canvas id="adminCategoryChart"></canvas>
            </article>
            <article class="chart-card">
              <div class="analytics-card-heading"><div><p class="small-title">WORKLOAD VIEW</p><h3>Complaints by department</h3></div><i class="fa-solid fa-building-columns"></i></div>
              <canvas id="adminDepartmentChart"></canvas>
            </article>
            <article class="chart-card analytics-wide">
              <div class="analytics-card-heading"><div><p class="small-title">SIX-MONTH VIEW</p><h3>Complaint submission and resolution trend</h3></div><i class="fa-solid fa-chart-line"></i></div>
              <canvas id="adminTrendChart"></canvas>
            </article>
            <article class="admin-panel performance-panel">
              <div class="analytics-card-heading"><div><p class="small-title">SERVICE PERFORMANCE</p><h3>Department resolution snapshot</h3></div><i class="fa-solid fa-stopwatch"></i></div>
              <div class="table-wrap"><table><thead><tr><th>Department</th><th>Total</th><th>Open</th><th>Resolved</th><th>Overdue</th><th>Avg. resolution</th></tr></thead><tbody id="departmentPerformanceRows"></tbody></table></div>
            </article>
          </section>
        </div>
      </section>
      `
    );
  }

  if (!$("#departmentPage")) {
    main.insertAdjacentHTML("beforeend", `
      <section class="page department-page" id="departmentPage">
        <div class="department-shell">
          <button class="back-button" data-page="home"><i class="fa-solid fa-arrow-left"></i> Home</button>
          <div class="portal-role-nav" aria-label="Department navigation">
            <button class="portal-nav-link active" data-page="department"><i class="fa-solid fa-gauge-high"></i> Dashboard</button>
            <button class="portal-nav-link" data-department-scroll="departmentComplaintRows"><i class="fa-solid fa-list-check"></i> Assigned Complaints</button>
            <button class="portal-nav-link" data-department-work><i class="fa-solid fa-clipboard-check"></i> Work Assignments</button>
            <button class="portal-nav-link" data-dashboard="notifications"><i class="fa-solid fa-bell"></i> Notifications</button>
            <button class="portal-nav-link" data-profile><i class="fa-solid fa-id-badge"></i> Profile</button>
            <button class="portal-nav-link logout-button" data-page="home"><i class="fa-solid fa-arrow-right-from-bracket"></i> Logout</button>
          </div>
          <div class="department-heading"><div><p class="small-title">DEPARTMENT STAFF PORTAL</p><h1>Welcome, <span id="departmentName">Department</span></h1><p>Only complaints assigned to your department appear here.</p></div></div>
          <div class="department-stat-grid" id="departmentStats"></div>
          <section class="department-panel">
            <div class="card-heading"><h2>Assigned Complaints</h2><span id="departmentResultCount" class="muted-label"></span></div>
            <div class="department-filter-row">
              <select id="departmentStatusFilter"><option value="">All</option><option>Submitted</option><option>Assigned</option><option>In Progress</option><option>Resolved</option><option>Closed</option><option>Rejected</option></select>
              <select id="departmentOverdueFilter"><option value="">All due dates</option><option value="true">Overdue</option></select>
              <button class="button button-primary" id="applyDepartmentFilters">Filter</button>
            </div>
            <div class="table-wrap"><table><thead><tr><th>Complaint ID</th><th>Title</th><th>Category</th><th>Priority</th><th>Status</th><th>Due date</th><th>Assigned staff</th><th>Action</th></tr></thead><tbody id="departmentComplaintRows"></tbody></table></div>
          </section>
        </div>
      </section>`);
  }

  const loginCard = $(".auth-card");

  if (loginCard && !$("#openRegisterButton")) {
    loginCard.insertAdjacentHTML(
      "beforeend",
      `
      <div class="auth-actions" aria-label="Account actions">
        <button id="openRegisterButton" class="auth-action auth-action-primary" data-page="register">
          <i class="fa-solid fa-user-plus"></i>
          <span>New student? <strong>Create an account</strong></span>
        </button>
        <button id="forgotPasswordButton" class="auth-action auth-action-secondary" type="button">
          <i class="fa-solid fa-key"></i>
          <span>Forgot your password?</span>
        </button>
      </div>
      `
    );
  }
}

function openPasswordReset() {
  $("#passwordResetOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay" id="passwordResetOverlay">
      <div class="notification-drawer">
        <div class="drawer-header"><h2>Forgot password</h2><button class="icon-button" data-close-password-reset aria-label="Back to login"><i class="fa-solid fa-xmark"></i></button></div>
        <div class="reset-brand"><img src="assets/images/logo.png" alt="BGMIT logo"><span>BGMIT MUDHOL</span></div>
        <p id="resetInstruction">Enter your registered email address to receive a password reset OTP for the ${escapeHtml(portalConfig[loginRole]?.title || "portal")}.</p>
        <form id="passwordResetForm" data-stage="email">
          <div id="resetEmailFields">
            <label for="resetEmail">Registered email</label>
            <input id="resetEmail" type="email" autocomplete="email" required>
          </div>
          <div id="resetOtpFields" class="hidden">
            <label for="resetOtp">Enter 6-digit OTP</label>
            <input id="resetOtp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456">
            <p id="resetExpiry" class="form-help" aria-live="polite"></p>
            <button type="button" id="resetChangeEmail" class="text-button">Change email</button>
          </div>
          <div id="resetPasswordFields" class="hidden">
            <label for="resetNewPassword">New password</label>
            <input id="resetNewPassword" type="password" autocomplete="new-password" minlength="8">
            <p id="resetPasswordStrength" class="form-help">Use at least 8 characters, including a letter and a number.</p>
            <label for="resetConfirmPassword">Confirm new password</label>
            <input id="resetConfirmPassword" type="password" autocomplete="new-password" minlength="8">
          </div>
          <p id="resetCooldown" class="form-help"></p>
          <button type="button" id="resetResendButton" class="text-button hidden">Resend OTP</button>
          <button class="button button-primary full-button" type="submit" id="resetSubmit">Send OTP</button>
        </form>
        <button type="button" class="text-button reset-login-link" data-close-password-reset><i class="fa-solid fa-arrow-left"></i> Back to Login</button>
      </div>
    </div>`);
  addPasswordToggles($("#passwordResetOverlay"));
}

function startResetCooldown(seconds) {
  const resend = $("#resetResendButton");
  const message = $("#resetCooldown");
  if (!resend || !message) return;
  window.clearInterval(window.resetCooldownTimer);
  let remaining = Math.max(0, Number(seconds) || 0);
  resend.classList.remove("hidden");
  resend.disabled = true;
  const update = () => {
    message.textContent = remaining > 0
      ? `For security, wait ${remaining}s before requesting another OTP.`
      : "You can request another OTP if the email did not arrive.";
  };
  update();
  window.resetCooldownTimer = window.setInterval(() => {
    remaining -= 1;
    update();
    if (remaining <= 0) {
      window.clearInterval(window.resetCooldownTimer);
      resend.disabled = false;
    }
  }, 1000);
}

function startResetExpiryCountdown(seconds = 300) {
  const expiry = $("#resetExpiry");
  if (!expiry) return;
  window.clearInterval(window.resetOtpExpiryTimer);
  let remaining = Math.max(0, Number(seconds) || 300);
  const update = () => {
    const minutes = Math.floor(remaining / 60);
    const secondsLeft = String(remaining % 60).padStart(2, "0");
    expiry.textContent = remaining > 0
      ? `OTP expires in ${minutes}:${secondsLeft}.`
      : "OTP expired. Request a new OTP.";
  };
  update();
  window.resetOtpExpiryTimer = window.setInterval(() => {
    remaining -= 1;
    update();
    if (remaining <= 0) window.clearInterval(window.resetOtpExpiryTimer);
  }, 1000);
}

function returnToResetEmailStage() {
  const form = $("#passwordResetForm");
  if (!form) return;
  form.dataset.stage = "email";
  delete form.dataset.resetToken;
  $("#resetEmail").disabled = false;
  $("#resetOtp").required = false;
  $("#resetNewPassword").required = false;
  $("#resetConfirmPassword").required = false;
  $("#resetOtpFields")?.classList.add("hidden");
  $("#resetPasswordFields")?.classList.add("hidden");
  $("#resetResendButton")?.classList.add("hidden");
  $("#resetCooldown").textContent = "";
  $("#resetExpiry").textContent = "";
  $("#resetInstruction").textContent = "Enter your registered email address to receive a password reset OTP.";
  $("#resetSubmit").textContent = "Send OTP";
  window.clearInterval(window.resetOtpExpiryTimer);
  window.clearInterval(window.resetCooldownTimer);
}

function addPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (!input.id || input.closest(".password-field")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "password-field";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    wrapper.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="password-toggle" data-password-target="${input.id}" aria-label="Show password"><i class="fa-regular fa-eye"></i></button>`
    );
  });
}

async function loadDepartmentDashboard() {
  if (!currentUser || currentUser.role !== "department") return;
  try {
    const data = await api("/department/dashboard");
    const stats = data.summary || {};
    $("#departmentName").textContent = `${data.department} Department`;
    $("#departmentStats").innerHTML = [
      ["Assigned Complaints", stats.total, "blue-icon", "fa-file-lines"],
      ["Pending", stats.pending, "yellow-icon", "fa-clock"],
      ["In Progress", stats.inProgress, "blue-icon", "fa-screwdriver-wrench"],
      ["Resolved", stats.resolved, "green-icon", "fa-circle-check"],
      ["Overdue", stats.overdue, "red-icon", "fa-triangle-exclamation"]
    ].map(([label, value, color, icon]) => `<article class="stat-card"><div class="round-icon ${color}"><i class="fa-solid ${icon}"></i></div><p>${label}</p><strong>${Number(value || 0)}</strong></article>`).join("");
    await loadDepartmentComplaints();
  } catch (error) { showToast(error.message, "error"); }
}

async function loadDepartmentComplaints() {
  if (!currentUser || currentUser.role !== "department") return;
  const status = $("#departmentStatusFilter")?.value || "";
  const isOverdue = $("#departmentOverdueFilter")?.value || "";
  const params = new URLSearchParams({ limit: "50" });
  if (status) params.set("status", status);
  if (isOverdue) params.set("isOverdue", isOverdue);

  const data = await api(`/department/complaints?${params.toString()}`);
  const rows = data.complaints || [];
  const resultCount = $("#departmentResultCount");
  if (resultCount) resultCount.textContent = `${data.pagination?.total || rows.length} complaint(s)`;
  const table = $("#departmentComplaintRows");
  if (!table) return;

  table.innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.ticketId)}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.priority)}</td>
      <td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
      <td>${formatDate(item.dueDate)}</td>
      <td>${escapeHtml(item.assignedTo?.fullName || "Not assigned")}</td>
      <td><button class="manage-button" data-department-complaint="${item._id}">Manage</button></td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty-state">No complaints match this filter.</td></tr>`;
}

async function openDepartmentComplaint(id) {
  const [detailData, staffData] = await Promise.all([
    api(`/department/complaints/${id}`),
    api("/department/staff")
  ]);
  const complaint = detailData.complaint;
  const staff = staffData.staff || [];
  $("#dialogOverlay")?.remove();

  const staffOptions = staff.map((member) => `<option value="${member.id}" ${String(complaint.assignedTo?.id || complaint.assignedTo?._id || "") === String(member.id) ? "selected" : ""}>${escapeHtml(member.fullName)}${member.email ? ` — ${escapeHtml(member.email)}` : ""}</option>`).join("");
  const statusOptions = ["Assigned", "In Progress", "Resolved", "Closed", "Rejected"]
    .map((status) => `<option ${complaint.status === status ? "selected" : ""}>${status}</option>`)
    .join("");

  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay detail-overlay" id="dialogOverlay">
      <aside class="notification-drawer">
        <div class="drawer-header"><div><p class="small-title">${escapeHtml(currentUser.department)} DEPARTMENT</p><h2>${escapeHtml(complaint.ticketId)}</h2></div><button class="icon-button" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <h3>${escapeHtml(complaint.title)}</h3>
        <div class="department-detail-grid">
          <p><strong>Student</strong><br>${escapeHtml(complaint.student?.fullName || "Student")}<br><small>${escapeHtml(complaint.student?.usn || "")}</small></p>
          <p><strong>Category</strong><br>${escapeHtml(complaint.category)}</p>
          <p><strong>Priority</strong><br>${escapeHtml(complaint.priority)}</p>
          <p><strong>Due date</strong><br>${formatDate(complaint.dueDate)}</p>
          <p><strong>Status</strong><br><span class="status ${statusClass(complaint.status)}">${escapeHtml(complaint.status)}</span></p>
          <p><strong>Location</strong><br>${escapeHtml(complaint.location)}</p>
        </div>
        <p><strong>Student description</strong><br>${escapeHtml(complaint.description)}</p>
        <h3>Attachments</h3>${attachmentListMarkup(complaint, "/department/complaints")}
        ${(complaint.beforePhoto ? `<p><button class="text-button" data-secure-file="/department/complaints/${complaint._id}/media/before" data-secure-file-name="${escapeHtml(complaint.ticketId)}-issue-photo">View issue photo</button></p>` : "")}
        ${(complaint.afterPhoto ? `<p><button class="text-button" data-secure-file="/department/complaints/${complaint._id}/media/after" data-secure-file-name="${escapeHtml(complaint.ticketId)}-resolution-photo">View resolution photo</button></p>` : "")}
        <div class="department-action-grid">
          <section>
            <h3>Accept responsibility</h3>
            <p class="form-help">Accepting records that your department has taken responsibility.</p>
            <button class="button button-light full-button" data-accept-complaint="${complaint._id}">Accept complaint</button>
          </section>
          <form id="departmentAssignWorkForm">
            <h3>Assign work</h3>
            <input type="hidden" id="departmentAssignComplaintId" value="${complaint._id}">
            <label for="departmentAssignedTo">Assign to ${escapeHtml(currentUser.department)} staff</label>
            <select id="departmentAssignedTo" required><option value="">Select staff member</option>${staffOptions}</select>
            <label for="departmentWorkDescription">Work description</label><textarea id="departmentWorkDescription" rows="3" required placeholder="What needs to be done?"></textarea>
            <label for="departmentWorkDueDate">Work due date</label><input id="departmentWorkDueDate" type="date" required>
            <button class="button button-primary full-button" type="submit">Assign work</button>
          </form>
          <form id="departmentStatusForm">
            <h3>Update complaint status</h3>
            <input type="hidden" id="departmentStatusComplaintId" value="${complaint._id}">
            <label for="departmentStatus">Status</label><select id="departmentStatus">${statusOptions}</select>
            <label for="departmentStatusNote">Work progress / resolution details</label><textarea id="departmentStatusNote" rows="3" placeholder="Add a clear update for the student."></textarea>
            <label for="departmentAfterPhoto">Resolution photo (optional)</label><input id="departmentAfterPhoto" type="file" accept="image/jpeg,image/png,image/webp">
            <button class="button button-primary full-button" type="submit">Update status</button>
          </form>
          <form id="departmentRemarkForm">
            <h3>Add department remark</h3>
            <input type="hidden" id="departmentRemarkComplaintId" value="${complaint._id}">
            <label for="departmentRemark">Remark</label><textarea id="departmentRemark" rows="4" required placeholder="Write a helpful update for the student."></textarea>
            <button class="button button-light full-button" type="submit">Add remark</button>
          </form>
        </div>
        <h3>Remarks and history</h3>
        <ul class="history-list">${[...(complaint.departmentRemarks || []).map((remark) => ({ status: "Department remark", note: remark.remark, changedAt: remark.addedAt })), ...(complaint.history || [])].sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt)).map((item) => `<li><strong>${escapeHtml(item.status)}</strong><br>${escapeHtml(item.note || "Status updated.")}<br><small>${formatDate(item.changedAt)}</small></li>`).join("") || "<li>No updates yet.</li>"}</ul>
      </aside>
    </div>`);
}

async function openDepartmentWorkAssignments() {
  const data = await api("/department/work-assignments");
  $("#dialogOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay" id="dialogOverlay"><aside class="notification-drawer">
      <div class="drawer-header"><h2>Work assignments</h2><button class="icon-button" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
      ${(data.assignments || []).length ? `<ul class="history-list">${data.assignments.map((item) => `<li><strong>${escapeHtml(item.ticketId)} — ${escapeHtml(item.title)}</strong><br>${escapeHtml(item.assignment.workDescription)}<br>Assigned to: ${escapeHtml(item.assignment.assignedTo?.fullName || "Staff member")}<br>Status: ${escapeHtml(item.assignment.workStatus)} · Due ${formatDate(item.assignment.dueDate)}</li>`).join("")}</ul>` : '<p class="empty-state">No work assignments have been created yet.</p>'}
    </aside></div>`);
}

function openAdminOverlay(title, content) {
  $("#dialogOverlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay detail-overlay" id="dialogOverlay">
      <aside class="notification-drawer">
        <div class="drawer-header"><h2>${escapeHtml(title)}</h2><button class="icon-button" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        ${content}
      </aside>
    </div>`);
  addPasswordToggles($("#dialogOverlay"));
}

function departmentOptions(selected = "") {
  return `<option value="">Select department</option>${departmentCodes.map((department) => `<option value="${department}" ${department === selected ? "selected" : ""}>${department}</option>`).join("")}`;
}

async function openAdminPanel(action) {
  if (!currentUser || currentUser.role !== "admin") return;

  if (action === "management") {
    openAdminOverlay("Complaint management", `
      <p class="form-help">Manage accounts, categories, notices, feedback and portal settings from one secure administrator-only area.</p>
      <div class="management-action-grid">
        <button class="admin-action-card" data-admin-action="students"><i class="fa-solid fa-user-graduate"></i><span>Students</span></button>
        <button class="admin-action-card" data-admin-action="staff"><i class="fa-solid fa-users-gear"></i><span>Department staff</span></button>
        <button class="admin-action-card" data-admin-action="categories"><i class="fa-solid fa-tags"></i><span>Categories</span></button>
        <button class="admin-action-card" data-admin-action="feedback"><i class="fa-solid fa-star"></i><span>Feedback</span></button>
        <button class="admin-action-card" data-admin-action="notices"><i class="fa-solid fa-bullhorn"></i><span>Notices</span></button>
        <button class="admin-action-card" data-admin-action="settings"><i class="fa-solid fa-gear"></i><span>Portal settings</span></button>
        <button class="admin-action-card" data-admin-action="activity"><i class="fa-solid fa-clock-rotate-left"></i><span>Activity log</span></button>
      </div>`);
    return;
  }

  if (action === "students" || action === "staff") {
    const endpoint = action === "students" ? "/admin/students" : "/admin/staff";
    const response = await api(endpoint);
    const users = response.students || response.staff || [];
    users.forEach((user) => adminUsersById.set(String(user.id), user));
    const title = action === "students" ? "Student accounts" : "Department staff accounts";
    openAdminOverlay(title, `
      ${action === "staff" ? `<button class="button button-primary" data-create-admin-user="department"><i class="fa-solid fa-user-plus"></i> Create department staff</button>` : ""}
      <div class="table-wrap" style="margin-top:16px;"><table><thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Active</th><th>Action</th></tr></thead><tbody>
        ${users.map((user) => `<tr><td>${escapeHtml(user.fullName)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.department || "-")}</td><td>${user.isActive ? "Yes" : "No"}</td><td><button class="text-button" data-edit-admin-user="${user.id}">Edit</button> ${user.isActive ? `<button class="text-button danger-button" data-deactivate-user="${user.id}" data-admin-panel="${action}">Deactivate</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-state">No accounts found.</td></tr>`}
      </tbody></table></div>`);
    return;
  }

  if (action === "departments") {
    const response = await api("/admin/departments");
    openAdminOverlay("Departments", `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Department</th><th>Staff</th><th>Complaints</th><th>Status</th><th>Action</th></tr></thead><tbody>${response.departments.map((department) => `<tr><td>${escapeHtml(department.code)}</td><td>${escapeHtml(department.name)}</td><td>${Number(department.staffCount || 0)}</td><td>${Number(department.complaintCount || 0)}</td><td>${department.isActive ? "Active" : "Inactive"}</td><td><button class="text-button" data-edit-department="${department.code}" data-department-name="${escapeHtml(department.name)}" data-department-description="${escapeHtml(department.description || "")}" data-department-active="${department.isActive}">Edit</button></td></tr>`).join("")}</tbody></table></div><p class="form-help">The five protected department codes are CSE, AIML, CIVIL, EC and MECHANICAL. Create staff accounts from the Staff screen.</p>`);
    return;
  }

  if (action === "feedback") {
    const response = await api("/admin/feedback");
    openAdminOverlay("Student feedback", (response.feedback || []).length ? `<ul class="history-list">${response.feedback.map((item) => `<li><strong>${escapeHtml(item.complaint?.ticketId || "Complaint")} — ${Number(item.rating)}/5</strong><br>${escapeHtml(item.comment || "No written comment.")}<br><small>${escapeHtml(item.student?.fullName || "Student")} · ${formatDate(item.createdAt)}</small></li>`).join("")}</ul>` : '<p class="empty-state">No feedback has been submitted.</p>');
    return;
  }

  if (action === "notices") {
    const response = await api("/notices/admin");
    openAdminOverlay("Campus notices", `
      <form id="adminNoticeForm">
        <label for="noticeTitle">Notice title</label><input id="noticeTitle" required maxlength="160">
        <label for="noticeMessage">Message</label><textarea id="noticeMessage" rows="4" required maxlength="3000"></textarea>
        <label for="noticeAudience">Audience</label><select id="noticeAudience"><option value="all">All visitors</option><option value="student">Students</option><option value="department">Department staff</option><option value="admin">Administrators</option></select>
        <label><input id="noticePinned" type="checkbox"> Pin this notice</label>
        <button class="button button-primary full-button" type="submit">Publish notice</button>
      </form>
      <hr style="margin:22px 0;border:0;border-top:1px solid #dce7f0;">
      <h3>Existing notices</h3>
      ${(response.notices || []).length ? `<ul class="history-list">${response.notices.map((notice) => `<li><strong>${escapeHtml(notice.title)}</strong> ${notice.isActive ? "" : "(inactive)"}<br>${escapeHtml(notice.message)}<br><small>Audience: ${escapeHtml(notice.audience)} · ${formatDate(notice.publishedAt)}</small><br><button class="text-button danger-button" data-delete-notice="${notice._id}">Delete</button></li>`).join("")}</ul>` : '<p class="empty-state">No notices created yet.</p>'}`);
    return;
  }

  if (action === "categories") {
    const response = await api("/admin/categories");
    const routingOptions = [...departmentCodes, "ADMIN"].map((target) => `<option>${target}</option>`).join("");
    openAdminOverlay("Complaint categories", `
      <form id="adminCategoryForm"><label for="adminCategoryName">New category name</label><input id="adminCategoryName" required><label for="adminCategoryDepartment">Route to</label><select id="adminCategoryDepartment">${routingOptions}</select><label for="adminCategoryDescription">Description (optional)</label><textarea id="adminCategoryDescription" rows="2"></textarea><label><input id="adminCategoryAdminOnly" type="checkbox"> Administrator-only category</label><button class="button button-primary full-button" type="submit">Create category</button></form>
      <hr style="margin:22px 0;border:0;border-top:1px solid #dce7f0;">
      <ul class="history-list">${(response.categories || []).map((category) => `<li><strong>${escapeHtml(category.name)}</strong> → ${escapeHtml(category.isAdminOnly ? "ADMIN (private)" : category.department)} ${category.isActive ? "" : "(inactive)"}<br><small>${escapeHtml(category.description || "No description")}</small><br><button class="text-button" data-edit-category="${category._id}" data-category-name="${escapeHtml(category.name)}" data-category-department="${escapeHtml(category.department)}" data-category-description="${escapeHtml(category.description || "")}" data-category-admin-only="${Boolean(category.isAdminOnly)}" data-category-active="${Boolean(category.isActive)}" data-category-student-visible="${category.isStudentVisible !== false}">Edit category</button></li>`).join("")}</ul>`);
    return;
  }

  if (action === "notifications") {
    openAdminOverlay("Send notification", `
      <form id="adminNotificationForm">
        <label for="adminNotificationMessage">Message</label><textarea id="adminNotificationMessage" rows="4" required maxlength="300" placeholder="Write an important portal update."></textarea>
        <label for="adminNotificationRole">Recipient role (optional)</label><select id="adminNotificationRole"><option value="">All active accounts</option><option value="student">Students</option><option value="department">Department staff</option><option value="admin">Administrators</option></select>
        <label for="adminNotificationDepartment">Department (optional)</label><select id="adminNotificationDepartment">${departmentOptions()}</select>
        <button class="button button-primary full-button" type="submit">Send notification</button>
      </form>
      <p class="form-help">Choose both Department staff and a department to target one department. System notifications about individual complaints continue automatically.</p>`);
    return;
  }

  if (action === "settings") {
    const response = await api("/admin/settings");
    const settings = response.settings || {};
    openAdminOverlay("Portal settings", `<form id="adminSettingsForm"><label for="settingPortalName">Portal name</label><input id="settingPortalName" value="${escapeHtml(settings.portalName || "Smart College Complaint Portal")}"><label for="settingSupportEmail">Support email</label><input id="settingSupportEmail" type="email" value="${escapeHtml(settings.supportEmail || "")}"><label for="settingMonthlyComplaintLimit">Monthly complaint limit per student</label><input id="settingMonthlyComplaintLimit" type="number" min="1" max="100" value="${Number(settings.monthlyComplaintLimit || 5)}"><p class="form-help">Every successfully created complaint counts, including complaints later rejected or reopened.</p><label for="settingDefaultComplaintPriority">Default backend priority</label><select id="settingDefaultComplaintPriority">${["Low", "Normal", "High", "Emergency"].map((priority) => `<option ${String(settings.defaultComplaintPriority || "Normal") === priority ? "selected" : ""}>${priority}</option>`).join("")}</select><label for="settingMaintenanceMessage">Maintenance message</label><textarea id="settingMaintenanceMessage" rows="4">${escapeHtml(settings.maintenanceMessage || "")}</textarea><button class="button button-primary full-button" type="submit">Save settings</button></form>`);
    return;
  }

  if (action === "activity") {
    const response = await api("/admin/activity");
    openAdminOverlay("Activity and audit trail", (response.logs || []).length ? `<ul class="history-list">${response.logs.map((log) => `<li><strong>${escapeHtml(log.action)}</strong><br>${escapeHtml(log.actor?.fullName || "System")} · ${escapeHtml(log.actor?.role || "system")}<br><small>${formatDate(log.createdAt)}</small></li>`).join("")}</ul>` : '<p class="empty-state">No activity recorded yet.</p>');
  }
}

function openAdminCategoryEditor(button) {
  const isAdminOnly = button.dataset.categoryAdminOnly === "true";
  const isActive = button.dataset.categoryActive !== "false";
  const isStudentVisible = button.dataset.categoryStudentVisible !== "false";
  const routingOptions = [...departmentCodes, "ADMIN"]
    .map(
      (target) =>
        `<option ${button.dataset.categoryDepartment === target ? "selected" : ""}>${target}</option>`
    )
    .join("");

  openAdminOverlay("Edit complaint category", `
    <form id="adminCategoryEditForm">
      <input id="editCategoryId" type="hidden" value="${escapeHtml(button.dataset.editCategory)}">
      <label for="editCategoryName">Category name</label>
      <input id="editCategoryName" required value="${escapeHtml(button.dataset.categoryName)}">
      <label for="editCategoryDepartment">Route to</label>
      <select id="editCategoryDepartment">${routingOptions}</select>
      <label for="editCategoryDescription">Description</label>
      <textarea id="editCategoryDescription" rows="3">${escapeHtml(button.dataset.categoryDescription || "")}</textarea>
      <label><input id="editCategoryAdminOnly" type="checkbox" ${isAdminOnly ? "checked" : ""}> Administrator-only category</label>
      <label><input id="editCategoryStudentVisible" type="checkbox" ${isStudentVisible ? "checked" : ""}> Show in student complaint form</label>
      <label><input id="editCategoryActive" type="checkbox" ${isActive ? "checked" : ""}> Category active</label>
      <button class="button button-primary full-button" type="submit">Save category</button>
    </form>`);
}

function openAdminUserEditor(id, forceRole = "") {
  const user = adminUsersById.get(String(id));
  const isNew = !user;
  const selectedRole = forceRole || user?.role || "department";
  openAdminOverlay(isNew ? "Create user account" : "Edit user account", `
    <form id="adminUserForm">
      <input type="hidden" id="adminUserId" value="${escapeHtml(user?.id || "")}">
      <label for="adminUserName">Full name</label><input id="adminUserName" value="${escapeHtml(user?.fullName || "")}" required>
      <label for="adminUserEmail">Email</label><input id="adminUserEmail" type="email" value="${escapeHtml(user?.email || "")}" required>
      <label for="adminUserRole">Role</label><select id="adminUserRole"><option value="student" ${selectedRole === "student" ? "selected" : ""}>Student</option><option value="department" ${selectedRole === "department" ? "selected" : ""}>Department staff</option><option value="admin" ${selectedRole === "admin" ? "selected" : ""}>Administrator</option></select>
      <label for="adminUserDepartment">Department (not required for Administrator)</label><select id="adminUserDepartment">${departmentOptions(user?.department || "")}</select>
      <label for="adminUserPhone">Phone</label><input id="adminUserPhone" value="${escapeHtml(user?.phone || "")}">
      <label for="adminUserPassword">${isNew ? "Password" : "New password (leave empty to keep current)"}</label><input id="adminUserPassword" type="password" ${isNew ? "required minlength=\"6\"" : "minlength=\"6\""}>
      <label><input id="adminUserActive" type="checkbox" ${user?.isActive === false ? "" : "checked"}> Account active</label>
      <button class="button button-primary full-button" type="submit">${isNew ? "Create account" : "Save changes"}</button>
    </form>`);
}

function openDepartmentEditor(code, name, description, isActive) {
  openAdminOverlay(`Edit ${code} department`, `
    <form id="adminDepartmentForm">
      <input type="hidden" id="editDepartmentCode" value="${escapeHtml(code)}">
      <label for="editDepartmentName">Display name</label><input id="editDepartmentName" value="${escapeHtml(name)}" required>
      <label for="editDepartmentDescription">Description</label><textarea id="editDepartmentDescription" rows="4">${escapeHtml(description)}</textarea>
      <label><input id="editDepartmentActive" type="checkbox" ${String(isActive) === "true" ? "checked" : ""}> Department active</label>
      <button class="button button-primary full-button" type="submit">Save department</button>
    </form>`);
}

// Load categories from backend.
async function loadCategories() {
  try {
    const data = await api("/complaints/categories");

    const categorySelect = $("#category");

    if (!categorySelect) return;

    categorySelect.innerHTML =
      '<option value="">Select category</option>' +
      data.categories
        .map(
          (item) =>
            `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`
        )
        .join("");

    // ADMIN is a routing target for transport/security issues, not a sixth
    // department that can receive work assignments.
    departments = [
      ...new Set(
        data.categories
          .map((item) => item.department)
          .filter((department) => department !== "ADMIN")
      )
    ];
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadPublicNotices() {
  const target = $("#publicNotices");
  if (!target) return;
  try {
    const data = await api("/notices");
    const notices = data.notices || [];
    target.innerHTML = notices.length
      ? notices.map((notice) => `
        <article class="notice-card ${notice.isPinned ? "pinned" : ""}">
          <h3>${notice.isPinned ? '<i class="fa-solid fa-thumbtack"></i> ' : ""}${escapeHtml(notice.title)}</h3>
          <p>${escapeHtml(notice.message)}</p>
          <small>Published ${formatDate(notice.publishedAt)}</small>
        </article>`).join("")
      : '<p class="empty-state">No campus notices have been published yet.</p>';
  } catch {
    target.innerHTML = '<p class="empty-state">Campus notices are unavailable right now.</p>';
  }
}

// Real Student dashboard.
async function loadStudentDashboard() {
  if (!currentUser || currentUser.role !== "student") return;

  try {
    const [dashboardData, complaintData, notificationData] =
      await Promise.all([
        api("/complaints/dashboard"),
        api("/complaints/my?limit=10"),
        api("/notifications")
      ]);

    $("#studentName").textContent = currentUser.fullName;

    $("#totalCount").textContent =
      dashboardData.summary.total;

    $("#pendingCount").textContent =
      dashboardData.summary.pending;

    $("#progressCount").textContent =
      dashboardData.summary.inProgress;

    $("#resolvedCount").textContent =
      dashboardData.summary.resolved;

    $("#rejectedCount").textContent =
      dashboardData.summary.rejected;

    const monthly = dashboardData.monthlySubmission || {};
    $("#monthlySubmittedCount").textContent = monthly.submitted ?? 0;
    $("#monthlyLimitCount").textContent = monthly.limit ?? 0;
    $("#monthlyRemainingCount").textContent = monthly.remaining ?? 0;
    $("#monthlyLimitMessage").textContent =
      monthly.remaining > 0
        ? `${monthly.remaining} complaint${monthly.remaining === 1 ? "" : "s"} remaining this calendar month.`
        : "Monthly limit reached. You can submit again next calendar month.";

    renderStudentComplaints(complaintData.complaints);

    const badge = $(".notification-count");

    if (badge) {
      badge.textContent = notificationData.unreadCount || "";
      badge.style.display =
        notificationData.unreadCount > 0 ? "flex" : "none";
    }

  } catch (error) {
    showToast(error.message, "error");
  }
}

// Student complaint table.
function renderStudentComplaints(complaints) {
  const table = $("#complaintTable");

  if (!table) return;

  if (!complaints.length) {
    table.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          No complaints yet. Submit your first campus issue.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML = complaints
    .map((complaint) => {
      const canGiveFeedback =
        complaint.status === "Resolved" ||
        complaint.status === "Closed";

      return `
        <tr>
          <td>${escapeHtml(complaint.ticketId)}</td>
          <td>${escapeHtml(complaint.category)}</td>
          <td>${escapeHtml(complaint.location)}</td>
          <td>
            <span class="status ${statusClass(complaint.status)}">
              ${escapeHtml(complaint.status)}
            </span>
          </td>
          <td>${formatDate(complaint.submittedAt || complaint.createdAt)}</td>
          <td>${formatDate(complaint.dueDate)}</td>
          <td>
            <button class="manage-button" data-student-complaint="${complaint._id}">View</button>
            ${
              canGiveFeedback
                ? `
                  <button class="manage-button"
                    data-feedback-id="${complaint._id}"
                    data-ticket-id="${complaint.ticketId}">
                    Feedback
                  </button>

                  <button class="manage-button"
                    data-reopen-id="${complaint._id}"
                    data-ticket-id="${complaint.ticketId}">
                    Reopen
                  </button>
                `
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

// Server-side ownership filters are always used. These controls only make the
// student's own history easier to search; they never expose other students.
async function loadStudentComplaintHistory() {
  if (!currentUser || currentUser.role !== "student") return;
  const params = new URLSearchParams({ limit: "25" });
  const search = $("#studentComplaintSearch")?.value.trim();
  const status = $("#studentComplaintStatus")?.value;
  if (search) params.set("q", search);
  if (status) params.set("status", status);
  const data = await api(`/complaints/my?${params.toString()}`);
  renderStudentComplaints(data.complaints || []);
}

// Submit real complaint to MongoDB.
async function submitComplaint(form) {
  if (!currentUser || currentUser.role !== "student") {
    showToast("Student login is required.", "error");
    return;
  }

  const formData = new FormData();

  formData.append("title", $("#title").value.trim());
  formData.append("category", $("#category").value);
  formData.append("location", $("#location").value.trim());
  formData.append("block", $("#block").value.trim());
  formData.append("room", $("#room").value.trim());
  formData.append(
    "description",
    $("#description").value.trim()
  );

  const photo = $("#photo").files[0];

  if (photo) {
    formData.append("photo", photo);
  }

  const attachments = Array.from($("#attachments")?.files || []);
  for (const attachment of attachments) {
    formData.append("attachments", attachment);
  }

  [
    ["busProblemType", "busProblemType"],
    ["busNumber", "busNumber"],
    ["busRoute", "busRoute"],
    ["busStop", "busStop"],
    ["travelDate", "travelDate"],
    ["travelTime", "travelTime"]
  ].forEach(([inputId, field]) => {
    const input = $(`#${inputId}`);
    if (input?.value) formData.append(field, input.value);
  });

  const selectedSimilar = document.querySelector("input[name='similarComplaintId']:checked");
  if (selectedSimilar) {
    formData.append("similarComplaintId", selectedSimilar.value);
  }

  const data = await api("/complaints", {
    method: "POST",
    body: formData
  });

  form.reset();

  showToast(
    `Complaint submitted. Save ID: ${data.complaint.ticketId}. ${data.monthlySubmission?.remaining ?? ""} remaining this month.`
  );

  showPage("dashboard");
}

function toggleBusFields() {
  const category = $("#category")?.value || "";
  const isBus = category === "Bus";
  const busPanel = $("#busDetails");
  const location = $("#location");
  const busProblemType = $("#busProblemType");

  if (busPanel) busPanel.classList.toggle("hidden", !isBus);
  if (location) {
    location.required = !isBus;
    location.placeholder = isBus
      ? "Optional: exact bus stop or place of incident"
      : "Example: Block A - Room 203";
  }
  if (busProblemType) busProblemType.required = isBus;
}

async function checkSimilarComplaints() {
  if (!currentUser || currentUser.role !== "student") return;
  const title = $("#title")?.value.trim() || "";
  const description = $("#description")?.value.trim() || "";
  const category = $("#category")?.value || "";
  const location = $("#location")?.value.trim() || "";
  const panel = $("#similarComplaintPanel");
  if (!panel) return;

  if (title.length < 5 || !category) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  try {
    const params = new URLSearchParams({ title, description, category, location });
    const data = await api(`/complaints/similar?${params.toString()}`);
    const matches = data.similarComplaints || [];
    if (!matches.length) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    panel.innerHTML = `
      <h3><i class="fa-solid fa-circle-info"></i> Similar open complaints found</h3>
      <p>Choose one only if you are reporting the same issue. You can still submit a separate complaint.</p>
      <ul class="similar-complaint-list">
        ${matches.map((match) => `<li><label><input type="radio" name="similarComplaintId" value="${match.id}"> Link to ${escapeHtml(match.ticketId)} (${Number(match.similarity)}% similar) — ${escapeHtml(match.title)} · ${escapeHtml(match.status)}</label></li>`).join("")}
        <li><label><input type="radio" name="similarComplaintId" value="" checked> Submit as a separate complaint</label></li>
      </ul>`;
    panel.classList.remove("hidden");
  } catch (error) {
    // Duplicate checking should never block a valid complaint submission.
    panel.classList.add("hidden");
  }
}

function activityIcon(status) {
  const icons = {
    Submitted: "fa-paper-plane",
    Assigned: "fa-share-nodes",
    "In Progress": "fa-screwdriver-wrench",
    Resolved: "fa-circle-check",
    Closed: "fa-lock",
    Reopened: "fa-rotate-left",
    Rejected: "fa-circle-xmark"
  };
  return icons[status] || "fa-circle-info";
}

// A complaint's history is append-only in MongoDB. This renderer preserves
// every recorded action in its original chronological order for the student.
function complaintTimelineMarkup(complaint) {
  const events = [...(complaint.history || [])]
    .sort((left, right) => new Date(left.changedAt) - new Date(right.changedAt));
  if (!events.length) {
    return '<p class="empty-state">The complaint timeline will appear after the first update.</p>';
  }

  return `<ol class="activity-timeline">${events.map((item) => {
    const actor = item.changedBy?.fullName
      ? `${item.changedBy.fullName}${item.changedBy.department ? ` · ${item.changedBy.department}` : ""}`
      : "Portal system";
    return `<li class="activity-item activity-${statusClass(item.status)}">
      <span class="activity-icon"><i class="fa-solid ${activityIcon(item.status)}"></i></span>
      <div class="activity-content">
        <div class="activity-heading"><strong>${escapeHtml(item.status)}</strong><time>${escapeHtml(formatDate(item.changedAt))}</time></div>
        <p>${escapeHtml(item.note || "Complaint updated.")}</p>
        <small><i class="fa-regular fa-user"></i> ${escapeHtml(actor)}</small>
      </div>
    </li>`;
  }).join("")}</ol>`;
}

function complaintProgressMarkup(complaint) {
  const milestonePosition = {
    Submitted: 1,
    Assigned: 2,
    "In Progress": 3,
    Resolved: 4,
    Closed: 4
  };
  const current = milestonePosition[complaint.status] || 1;
  const labels = ["Submitted", "Assigned", "Work in progress", "Resolved"];
  return `<div class="complaint-progress" aria-label="Complaint progress">${labels.map((label, index) => {
    const position = index + 1;
    const state = position < current ? "complete" : position === current ? "active" : "";
    return `<div class="progress-step ${state}"><span>${position < current ? '<i class="fa-solid fa-check"></i>' : position}</span><small>${escapeHtml(label)}</small></div>`;
  }).join("")}</div>`;
}

function complaintRemarkMarkup(complaint) {
  const remarks = complaint.departmentRemarks || [];
  const adminResponse = complaint.adminResponse
    ? `<article class="remark-card admin-remark"><strong><i class="fa-solid fa-user-shield"></i> Administration</strong><p>${escapeHtml(complaint.adminResponse)}</p></article>`
    : "";
  const departmentRemarks = remarks.map((remark) => `
    <article class="remark-card"><strong><i class="fa-solid fa-building"></i> ${escapeHtml(remark.addedBy?.fullName || "Department update")}</strong><p>${escapeHtml(remark.remark)}</p><small>${escapeHtml(formatDate(remark.addedAt))}</small></article>`).join("");
  return adminResponse || departmentRemarks || '<p class="empty-state">No remarks have been added yet.</p>';
}

function complaintEvidenceMarkup(complaint, routePrefix = "/complaints") {
  const id = complaint._id;
  return `<div class="evidence-grid">
    <section><h4><i class="fa-solid fa-camera"></i> Issue evidence</h4>${complaint.beforePhoto ? `<button class="evidence-button" data-secure-file="${routePrefix}/${id}/media/before" data-secure-file-name="${escapeHtml(complaint.ticketId)}-issue-photo"><i class="fa-regular fa-image"></i> View issue photo</button>` : "<p>No issue photo uploaded.</p>"}</section>
    <section><h4><i class="fa-solid fa-camera-retro"></i> Resolution evidence</h4>${complaint.afterPhoto ? `<button class="evidence-button" data-secure-file="${routePrefix}/${id}/media/after" data-secure-file-name="${escapeHtml(complaint.ticketId)}-resolution-photo"><i class="fa-regular fa-image"></i> View resolution photo</button>` : "<p>Resolution photo not uploaded yet.</p>"}</section>
  </div>`;
}

// Track a private complaint by ticket ID. The server independently verifies
// ownership, so a guessed ID cannot reveal another student's complaint.
async function trackComplaint(form) {
  const ticketId = $("#trackId").value.trim().toUpperCase();

  if (!ticketId) return;

  const data = await api(
    `/complaints/track/${encodeURIComponent(ticketId)}`
  );

  const complaint = data.complaint;
  const result = $("#trackResult");

  result.classList.remove("hidden");

  result.innerHTML = `
    <h3>${escapeHtml(complaint.ticketId)}: ${escapeHtml(complaint.title)}</h3>

    ${
      complaint.isOverdue
        ? '<div class="overdue-warning">This complaint exceeded the expected resolution date and was escalated.</div>'
        : ""
    }

    <div class="tracking-summary-grid">
      <p><strong>Current status</strong><br><span class="status ${statusClass(complaint.status)}">${escapeHtml(complaint.status)}</span></p>
      <p><strong>Assigned department</strong><br>${escapeHtml(complaint.department)}</p>
      <p><strong>Assigned staff</strong><br>${escapeHtml(complaint.assignedTo?.fullName || "Not assigned yet")}</p>
      <p><strong>Expected resolution</strong><br>${escapeHtml(formatDate(complaint.dueDate))}</p>
      <p><strong>Submitted</strong><br>${escapeHtml(formatDate(complaint.submittedAt || complaint.createdAt))}</p>
      <p><strong>Location</strong><br>${escapeHtml(complaint.location)}</p>
    </div>
    ${complaintProgressMarkup(complaint)}
    <section class="tracking-section"><h4>What is happening</h4>${complaintTimelineMarkup(complaint)}</section>
    <section class="tracking-section"><h4>Department and administration remarks</h4>${complaintRemarkMarkup(complaint)}</section>
    <section class="tracking-section"><h4>Attachments</h4>${attachmentListMarkup(complaint)}</section>
    <section class="tracking-section"><h4>Before and after evidence</h4>${complaintEvidenceMarkup(complaint)}</section>
    ${complaint.resolutionNote ? `<section class="tracking-section resolution-note"><h4>Resolution details</h4><p>${escapeHtml(complaint.resolutionNote)}</p></section>` : ""}
  `;
}

function attachmentListMarkup(complaint, routePrefix = "/complaints") {
  const attachments = complaint.attachments || [];
  if (!attachments.length) return '<p class="empty-state">No attachments uploaded.</p>';
  return `<ul class="history-list">${attachments.map((attachment, index) => `
    <li><button class="text-button" data-secure-file="${routePrefix}/${complaint._id}/attachments/${index}" data-secure-file-name="${escapeHtml(attachment.originalName || "attachment")}"><i class="fa-solid fa-paperclip"></i> ${escapeHtml(attachment.originalName || "Open attachment")}</button></li>`).join("")}</ul>`;
}

async function openProtectedFile(path, filename) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Could not open this protected file.");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const openedWindow = window.open(objectUrl, "_blank", "noopener");
  if (!openedWindow) {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "attachment";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60 * 1000);
}

async function openStudentComplaint(id) {
  const data = await api(`/complaints/${id}`);
  const complaint = data.complaint;
  $("#dialogOverlay")?.remove();

  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay detail-overlay" id="dialogOverlay">
      <aside class="notification-drawer">
        <div class="drawer-header">
          <div><p class="small-title">YOUR COMPLAINT</p><h2>${escapeHtml(complaint.ticketId)}</h2></div>
          <button class="icon-button" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <h3>${escapeHtml(complaint.title)}</h3>
        <div class="department-detail-grid">
          <p><strong>Status</strong><br><span class="status ${statusClass(complaint.status)}">${escapeHtml(complaint.status)}</span></p>
          <p><strong>Assigned department</strong><br>${escapeHtml(complaint.isAdminOnly ? "Administration" : complaint.department)}</p>
          <p><strong>Category</strong><br>${escapeHtml(complaint.category)}</p>
          <p><strong>Submitted</strong><br>${formatDate(complaint.submittedAt || complaint.createdAt)}</p>
          <p><strong>Due date</strong><br>${formatDate(complaint.dueDate)}</p>
          <p><strong>Assigned staff</strong><br>${escapeHtml(complaint.assignedTo?.fullName || "Not assigned yet")}</p>
          <p><strong>Location</strong><br>${escapeHtml(complaint.location)}</p>
        </div>
        <p><strong>Description</strong><br>${escapeHtml(complaint.description)}</p>
        <h3>Attachments</h3>${attachmentListMarkup(complaint)}
        ${(complaint.beforePhoto ? `<p><button class="text-button" data-secure-file="/complaints/${complaint._id}/media/before" data-secure-file-name="${escapeHtml(complaint.ticketId)}-issue-photo">View issue photo</button></p>` : "")}
        ${(complaint.afterPhoto ? `<p><button class="text-button" data-secure-file="/complaints/${complaint._id}/media/after" data-secure-file-name="${escapeHtml(complaint.ticketId)}-resolution-photo">View resolution photo</button></p>` : "")}
        ${complaintProgressMarkup(complaint)}
        <h3>Department / administration remarks</h3>
        ${complaintRemarkMarkup(complaint)}
        <h3>Complete activity timeline</h3>
        ${complaintTimelineMarkup(complaint)}
        <h3>Before and after evidence</h3>
        ${complaintEvidenceMarkup(complaint)}
      </aside>
    </div>`);
}

function openProfileDialog() {
  if (!currentUser) return;
  $("#dialogOverlay")?.remove();
  const canEditSemester = currentUser.role === "student";
  document.body.insertAdjacentHTML("beforeend", `
    <div class="notification-overlay" id="dialogOverlay">
      <aside class="notification-drawer">
        <div class="drawer-header"><h2>My profile</h2><button class="icon-button" data-close-dialog aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
        <p class="form-help">Role and department are managed securely by the administrator and cannot be changed here.</p>
        <form id="profileForm">
          <label for="profileFullName">Full name</label><input id="profileFullName" value="${escapeHtml(currentUser.fullName)}" required>
          <label for="profileEmail">Email address</label><input id="profileEmail" value="${escapeHtml(currentUser.email)}" disabled>
          <label for="profileDepartment">Department</label><input id="profileDepartment" value="${escapeHtml(currentUser.department || "-")}" disabled>
          <label for="profilePhone">Phone number</label><input id="profilePhone" value="${escapeHtml(currentUser.phone || "")}" placeholder="Optional phone number">
          ${canEditSemester ? `<label for="profileSemester">Semester</label><input id="profileSemester" value="${escapeHtml(currentUser.semester || "")}" maxlength="10">` : ""}
          <label for="profileBio">Short bio</label><textarea id="profileBio" rows="3" maxlength="300" placeholder="Optional short introduction">${escapeHtml(currentUser.profile?.bio || "")}</textarea>
          <button class="button button-primary full-button" type="submit">Save profile</button>
        </form>
        <hr style="margin:22px 0;border:0;border-top:1px solid #dce7f0;">
        <h3>Change password</h3>
        <form id="changePasswordForm">
          <label for="currentPassword">Current password</label><input id="currentPassword" type="password" autocomplete="current-password" required>
          <label for="newPassword">New password</label><input id="newPassword" type="password" autocomplete="new-password" minlength="6" required>
          <label for="confirmPassword">Confirm new password</label><input id="confirmPassword" type="password" autocomplete="new-password" minlength="6" required>
          <button class="button button-light full-button" type="submit">Change password</button>
        </form>
      </aside>
    </div>`);
  addPasswordToggles($("#dialogOverlay"));
}

// Timeline circle.
function timelineStep(number, label, status, stepNumber) {
  const statusPosition = {
    Submitted: 1,
    Assigned: 2,
    "In Progress": 3,
    Resolved: 4,
    Closed: 4,
    Reopened: 3
  };

  const currentStep = statusPosition[status] || 1;

  let className = "";

  if (currentStep >= stepNumber) className += " complete";
  if (currentStep === stepNumber) className += " active";

  return `
    <div class="timeline-item${className}">
      <span>${number}</span>
      <p>${label}</p>
    </div>
  `;
}

// Show Notification drawer.
async function openNotifications() {
  const data = await api("/notifications");

  const oldDrawer = $("#notificationOverlay");

  if (oldDrawer) {
    oldDrawer.remove();
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="notificationOverlay" class="notification-overlay">
      <aside class="notification-drawer">
        <div class="drawer-header">
          <h2>Notifications</h2>
          <button class="icon-button" data-close-notifications>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <button id="readAllButton" class="text-button">
          Mark All as Read
        </button>

        <div style="margin-top:15px;">
          ${
            data.notifications.length
              ? data.notifications
                  .map(
                    (notification) => `
                    <article
                      class="notification-item ${notification.isRead ? "" : "unread"}"
                      data-notification-id="${notification._id}"
                    >
                      <p>${escapeHtml(notification.message)}</p>
                      <small>${formatDate(notification.createdAt)}</small>
                    </article>
                  `
                  )
                  .join("")
              : '<p class="empty-state">No notifications yet.</p>'
          }
        </div>
      </aside>
    </div>
    `
  );
}

// Load Admin/Department dashboard.
async function loadAdminDashboard() {
  if (!currentUser || currentUser.role !== "admin") return;

  try {
    const params = getAdminFilterParams();
    const query = params.toString();
    const [dashboardData, complaintsData] = await Promise.all([
      api(`/admin/dashboard${query ? `?${query}` : ""}`),
      api(`/admin/complaints?${new URLSearchParams({ ...Object.fromEntries(params), limit: "20" }).toString()}`)
    ]);

    $("#adminWelcome").textContent =
      `${currentUser.fullName} — ${currentUser.role === "admin" ? "Administrator" : currentUser.department}`;

    renderAdminStats(dashboardData);
    renderAdminComplaints(complaintsData.complaints);
    drawAdminChart(dashboardData.byCategory);
    drawAdminDepartmentChart(dashboardData.byDepartment || []);
    drawAdminTrendChart(dashboardData.monthlyTrend || []);
    renderDepartmentPerformance(dashboardData.departmentPerformance || []);
  } catch (error) {
    showToast(error.message, "error");
  }
}

// One source of truth for the table, charts, Excel, and PDF filters. The
// backend repeats authorization and query validation before returning data.
function getAdminFilterParams({ includeSearch = true } = {}) {
  const params = new URLSearchParams();
  const search = $("#adminSearch")?.value.trim();
  const department = $("#adminDepartmentFilter")?.value;
  const status = $("#adminStatusFilter")?.value;
  const priority = $("#adminPriorityFilter")?.value;
  const due = $("#adminDueFilter")?.value;
  const from = $("#adminFromDate")?.value;
  const to = $("#adminToDate")?.value;
  const trend = $("#adminTrendGranularity")?.value;
  if (includeSearch && search) params.set("q", search);
  if (department) params.set("department", department);
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (due) params.set("due", due);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (trend) params.set("trend", trend);
  return params;
}

// Admin count cards.
function renderAdminStats(data) {
  const summary = data.summary || {};
  const cards = [
    ["Total", summary.total],
    ["Submitted", summary.submitted],
    ["Assigned", summary.assigned],
    ["In Progress", summary.inProgress],
    ["Resolved", summary.resolved],
    ["Overdue", summary.overdue],
    ["Escalated", summary.escalated],
    ["Due today", summary.dueToday],
    ["Next 7 days", summary.upcoming],
    ["On-time resolved", data.onTimeResolved],
    ["Avg. rating", `${data.averageFeedbackRating || 0}/5`],
    ["Feedback", data.totalFeedback],
    ["Avg. resolution", `${data.averageResolutionHours || 0}h`]
  ];

  $("#adminStats").innerHTML = cards
    .map(
      ([label, value]) =>
        `<article class="admin-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`
    )
    .join("");
}

// Admin complaint table.
function renderAdminComplaints(complaints = []) {
  const table = $("#adminComplaintRows");

  if (!complaints.length) {
    table.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          No complaints match these filters.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML = complaints
    .map(
      (complaint) => `
      <tr>
        <td>${escapeHtml(complaint.ticketId)}</td>
        <td>
          ${escapeHtml(complaint.title)}
          ${
            complaint.isOverdue
              ? '<br><small style="color:#d84a58;">Overdue</small>'
              : ""
          }
        </td>
        <td>${escapeHtml(complaint.isAdminOnly ? "Administration" : complaint.department)}</td>
        <td>${escapeHtml(complaint.priority)}</td>
        <td>
          <span class="status ${statusClass(complaint.status)}">
            ${escapeHtml(complaint.status)}
          </span>
        </td>
        <td>${formatDate(complaint.submittedAt || complaint.createdAt)}</td>
        <td>${formatDate(complaint.dueDate)}</td>
        <td>
          <button class="manage-button" data-manage-id="${complaint._id}">
            Manage
          </button>
        </td>
      </tr>
    `
    )
    .join("");
}

// Show selected complaint in management panel.
async function manageComplaint(id) {
  const data = await api(`/admin/complaints/${id}`);
  const complaint = data.complaint;
  const isAdministratorOnly = Boolean(complaint.isAdminOnly);

  let departmentStaff = [];
  if (departmentCodes.includes(complaint.department)) {
    const staffData = await api(`/admin/departments/${complaint.department}/staff`);
    departmentStaff = staffData.staff || [];
  }

  const departmentOptions = [
    `<option value="" disabled ${departmentCodes.includes(complaint.department) ? "" : "selected"}>${departmentCodes.includes(complaint.department) ? "Select department" : "Administrator handling — select a department to reassign"}</option>`,
    ...departments
    .map(
      (department) => `
      <option value="${escapeHtml(department)}"
        ${complaint.department === department ? "selected" : ""}>
        ${escapeHtml(department)}
      </option>
    `
    )
  ].join("");

  const staffOptions = departmentStaff.map((staffMember) => `
    <option value="${staffMember.id}" ${String(complaint.assignedTo?.id || complaint.assignedTo?._id || "") === String(staffMember.id) ? "selected" : ""}>
      ${escapeHtml(staffMember.fullName)}
    </option>`).join("");
  const statusOptions = [
    "Submitted",
    "Assigned",
    "In Progress",
    "Resolved",
    "Closed",
    "Rejected"
  ]
    .map(
      (status) =>
        `<option ${complaint.status === status ? "selected" : ""}>${status}</option>`
    )
    .join("");

  $("#managePanel").innerHTML = `
    <h2>Manage ${escapeHtml(complaint.ticketId)}</h2>

    <div class="manage-info">
      <strong>${escapeHtml(complaint.title)}</strong><br>
      Student: ${escapeHtml(complaint.student?.fullName)}<br>
      Location: ${escapeHtml(complaint.location)}<br>
      Category: ${escapeHtml(complaint.category)}<br>
      Handling: ${escapeHtml(isAdministratorOnly ? "Administration only" : complaint.department)}<br>
      Submitted: ${formatDate(complaint.submittedAt || complaint.createdAt)}<br>
      Due date: ${formatDate(complaint.dueDate)}<br>
      Current Status: ${escapeHtml(complaint.status)}
    </div>

    <h3 style="margin-top:18px;">Complaint evidence</h3>
    ${attachmentListMarkup(complaint, "/admin/complaints")}
    ${(complaint.beforePhoto ? `<button class="text-button" data-secure-file="/admin/complaints/${complaint._id}/media/before" data-secure-file-name="${escapeHtml(complaint.ticketId)}-issue-photo">View issue photo</button>` : "")}
    ${(complaint.afterPhoto ? `<button class="text-button" data-secure-file="/admin/complaints/${complaint._id}/media/after" data-secure-file-name="${escapeHtml(complaint.ticketId)}-resolution-photo">View resolution photo</button>` : "")}

    ${
      currentUser.role === "admin" && !isAdministratorOnly
        ? `
        <form id="assignComplaintForm">
          <input type="hidden" id="assignComplaintId" value="${complaint._id}">

          <label for="assignDepartment">Assign Department</label>
          <select id="assignDepartment">${departmentOptions}</select>

          <label for="assignStaff">Assign staff member (optional)</label>
          <select id="assignStaff"><option value="">Department will choose later</option>${staffOptions}</select>

          <label for="assignNote">Assignment Note</label>
          <textarea id="assignNote" rows="3" placeholder="Example: Technician assigned."></textarea>

          <button class="button button-primary full-button" type="submit">
            Assign Department
          </button>
        </form>
        `
        : `<p class="admin-only-note"><i class="fa-solid fa-lock"></i> This private category is handled by Administration. It cannot be sent to an ordinary department.</p>`
    }

    <form id="priorityComplaintForm">
      <input type="hidden" id="priorityComplaintId" value="${complaint._id}">
      <label for="prioritySelect">Priority and due date</label>
      <select id="prioritySelect">
        ${["Low", "Normal", "High", "Emergency"].map((priority) => `<option ${complaint.priority === priority ? "selected" : ""}>${priority}</option>`).join("")}
      </select>
      <label for="priorityDueDate">Due date (optional)</label>
      <input id="priorityDueDate" type="date" value="${complaint.dueDate ? new Date(complaint.dueDate).toISOString().slice(0, 10) : ""}">
      <button class="button button-light full-button" type="submit">Update priority</button>
    </form>

    <hr style="margin:20px 0; border:0; border-top:1px solid #dce7f0;">

    <form id="updateStatusForm">
      <input type="hidden" id="statusComplaintId" value="${complaint._id}">

      <label for="statusSelect">Update Status</label>
      <select id="statusSelect">
        ${statusOptions}
      </select>

      <label for="statusNote">Work / Resolution Note</label>
      <textarea id="statusNote" rows="4" placeholder="Explain the current work or resolution."></textarea>

      <label for="afterPhoto">Resolution Photo (optional)</label>
      <input id="afterPhoto" type="file" accept="image/jpeg,image/png,image/webp">

      <button class="button button-primary full-button" type="submit">
        Update Status
      </button>
    </form>

    <ul class="history-list">
      ${complaint.history
        .map(
          (item) => `
          <li>
            <strong>${escapeHtml(item.status)}</strong><br>
            ${escapeHtml(item.note || "Status updated.")}
            <br><small>${formatDate(item.changedAt)}</small>
          </li>
        `
        )
        .join("")}
    </ul>
  `;
}

async function loadAdminStaffOptions(department) {
  const select = $("#assignStaff");
  if (!select) return;
  select.innerHTML = '<option value="">Loading staff…</option>';
  if (!departmentCodes.includes(department)) {
    select.innerHTML = '<option value="">No staff assignment for this route</option>';
    return;
  }
  const data = await api(`/admin/departments/${encodeURIComponent(department)}/staff`);
  select.innerHTML = '<option value="">Department will choose later</option>' + (data.staff || []).map((staffMember) => `<option value="${staffMember.id}">${escapeHtml(staffMember.fullName)}</option>`).join("");
}

// Admin category chart.
function drawAdminChart(items) {
  const chartTarget = $("#adminCategoryChart");
  if (!window.Chart || !chartTarget) return;

  if (adminChart) {
    adminChart.destroy();
  }

  adminChart = new Chart(chartTarget, {
    type: "bar",
    data: {
      labels: items.map((item) => item.label),
      datasets: [
        {
          label: "Complaints",
          data: items.map((item) => item.value),
          backgroundColor: "#1976dd",
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

function drawAdminDepartmentChart(items) {
  const chartTarget = $("#adminDepartmentChart");
  if (!window.Chart || !chartTarget) return;
  if (adminDepartmentChart) adminDepartmentChart.destroy();

  adminDepartmentChart = new Chart(chartTarget, {
    type: "doughnut",
    data: {
      labels: items.map((item) => item.label),
      datasets: [{
        data: items.map((item) => item.value),
        backgroundColor: ["#1976dd", "#7659d9", "#1ba467", "#f2a600", "#e94d59"],
        borderColor: "#ffffff",
        borderWidth: 3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, usePointStyle: true }
        }
      }
    }
  });
}

function drawAdminTrendChart(items) {
  const chartTarget = $("#adminTrendChart");
  if (!window.Chart || !chartTarget) return;
  if (adminTrendChart) adminTrendChart.destroy();

  adminTrendChart = new Chart(chartTarget, {
    type: "line",
    data: {
      labels: items.map((item) => item.label),
      datasets: [
        {
          label: "Submitted",
          data: items.map((item) => item.submitted),
          borderColor: "#1976dd",
          backgroundColor: "rgba(25, 118, 221, .12)",
          fill: true,
          tension: .35
        },
        {
          label: "Resolved",
          data: items.map((item) => item.resolved),
          borderColor: "#1ba467",
          backgroundColor: "rgba(27, 164, 103, .08)",
          fill: true,
          tension: .35
        }
      ]
    },
    options: {
      responsive: true,
      interaction: { intersect: false, mode: "index" },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

function renderDepartmentPerformance(items) {
  const target = $("#departmentPerformanceRows");
  if (!target) return;
  target.innerHTML = items.length
    ? items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.department)}</strong></td>
        <td>${Number(item.total || 0)}</td>
        <td>${Number(item.open || 0)}</td>
        <td>${Number(item.resolved || 0)}</td>
        <td>${Number(item.overdue || 0)}</td>
        <td>${Number(item.averageResolutionHours || 0)}h</td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="empty-state">No department performance data yet.</td></tr>';
}

// Search/filter admin complaints.
async function filterAdminComplaints() {
  // Refresh the full dashboard, not just the table. This keeps every chart
  // and insight consistent with the selected date/department filters.
  await loadAdminDashboard();
}

// Download a real .xlsx workbook that opens directly in Microsoft Excel.
async function downloadCsv() {
  const token = localStorage.getItem(TOKEN_KEY);
  const params = getAdminFilterParams();

  const response = await fetch(`${API_BASE}/admin/export.xlsx?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error("Could not download the Excel report.");
  }

  const blob = await response.blob();

  const downloadUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "bgmit-complaint-report.xlsx";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(downloadUrl);
}

const officialReportDescriptions = {
  individual: "Print one complete complaint file, including its history and resolution details.",
  history: "Print the complete complaint register and recorded activity history.",
  department: "Print a department-specific complaint register and performance summary.",
  monthly: "Print the current month, unless you select a custom date range.",
  yearly: "Print the current year, unless you select a custom date range.",
  overdue: "Print unresolved complaints that have crossed their resolution deadline.",
  resolution: "Print resolved and closed complaints with resolution information.",
  analytics: "Print administration statistics, department comparison and complaint register."
};

function openOfficialPrintCentre() {
  if (!currentUser || currentUser.role !== "admin") {
    showToast("Administrator access is required.", "error");
    return;
  }
  const selectedDepartment = $("#adminDepartmentFilter")?.value || "";
  const selectedFrom = $("#adminFromDate")?.value || "";
  const selectedTo = $("#adminToDate")?.value || "";
  const departmentChoices = ["CSE", "AIML", "CIVIL", "EC", "MECHANICAL", "ADMIN"]
    .map((department) => `<option value="${department}" ${department === selectedDepartment ? "selected" : ""}>${department === "ADMIN" ? "Administration" : department}</option>`)
    .join("");

  openAdminOverlay("Official college printing", `
    <section class="official-report-intro">
      <span class="official-report-lock"><i class="fa-solid fa-shield-halved"></i></span>
      <div><p class="small-title">ADMINISTRATOR-ONLY</p><p>Generate an A4-ready BGMIT document. The report includes a blank Principal signature and official seal area for physical approval.</p></div>
    </section>
    <form id="officialReportForm">
      <label for="officialReportType">Official report type</label>
      <select id="officialReportType" required>
        <option value="analytics">Administrative analytics report</option>
        <option value="history">Complete complaint history</option>
        <option value="department">Department-wise report</option>
        <option value="monthly">Monthly report</option>
        <option value="yearly">Yearly report</option>
        <option value="overdue">Overdue complaint report</option>
        <option value="resolution">Complaint resolution report</option>
        <option value="individual">Individual complaint report</option>
      </select>
      <p id="officialReportDescription" class="form-help"></p>
      <div id="officialTicketField" class="hidden">
        <label for="officialReportTicketId">Complaint ticket ID</label>
        <input id="officialReportTicketId" placeholder="Example: CMP-20261003-AB12CD34">
      </div>
      <div id="officialDepartmentField" class="hidden">
        <label for="officialReportDepartment">Department</label>
        <select id="officialReportDepartment"><option value="">Select department</option>${departmentChoices}</select>
      </div>
      <div class="input-grid official-date-grid">
        <div><label for="officialReportFrom">From date (optional)</label><input id="officialReportFrom" type="date" value="${escapeHtml(selectedFrom)}"></div>
        <div><label for="officialReportTo">To date (optional)</label><input id="officialReportTo" type="date" value="${escapeHtml(selectedTo)}"></div>
      </div>
      <p class="form-help">For monthly and yearly reports, leave both dates empty to use the current calendar period. Dates use India Standard Time.</p>
      <div class="official-report-actions">
        <button class="button button-primary" type="submit"><i class="fa-solid fa-file-signature"></i> Print / Save Official PDF</button>
        <button class="button button-light" id="downloadOfficialExcelButton" type="button"><i class="fa-solid fa-file-excel"></i> Download Official Excel</button>
      </div>
    </form>`);
  syncOfficialReportFields();
}

function syncOfficialReportFields() {
  const type = $("#officialReportType")?.value || "analytics";
  const ticketField = $("#officialTicketField");
  const departmentField = $("#officialDepartmentField");
  const ticket = $("#officialReportTicketId");
  const department = $("#officialReportDepartment");
  if (ticketField) ticketField.classList.toggle("hidden", type !== "individual");
  if (departmentField) departmentField.classList.toggle("hidden", type !== "department");
  if (ticket) ticket.required = type === "individual";
  if (department) department.required = type === "department";
  const description = $("#officialReportDescription");
  if (description) description.textContent = officialReportDescriptions[type] || "";
}

function officialDateLabel(value) {
  return value ? formatDate(value) : "All available dates";
}

function getOfficialReportRequest() {
  const type = $("#officialReportType")?.value || "analytics";
  const params = new URLSearchParams();
  const department = $("#officialReportDepartment")?.value || "";
  const ticketId = $("#officialReportTicketId")?.value.trim() || "";
  const from = $("#officialReportFrom")?.value || "";
  const to = $("#officialReportTo")?.value || "";
  if (type === "individual" && !ticketId) {
    throw new Error("Enter a complaint ticket ID for the individual report.");
  }
  if (type === "department" && !department) {
    throw new Error("Select a department for the department-wise report.");
  }
  if (from && to && from > to) {
    throw new Error("The From date cannot be after the To date.");
  }
  if (department) params.set("department", department);
  if (ticketId) params.set("ticketId", ticketId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return { type, params };
}

function officialSummaryMarkup(summary) {
  const items = [
    ["Total complaints", summary.total],
    ["Pending", Number(summary.submitted || 0) + Number(summary.assigned || 0)],
    ["In progress", summary.inProgress],
    ["Resolved", summary.resolved],
    ["Overdue", summary.overdue],
    ["Escalated", summary.escalated],
    ["Avg. resolution", `${summary.averageResolutionHours || 0} hours`],
    ["Student satisfaction", `${summary.averageFeedbackRating || 0}/5 (${summary.feedbackCount || 0})`]
  ];
  return `<section class="official-summary">${items.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong></article>`).join("")}</section>`;
}

function officialComplaintTableMarkup(complaints) {
  return `<table class="official-table"><thead><tr><th>Ticket ID</th><th>Complaint details</th><th>Student</th><th>Department</th><th>Priority</th><th>Status</th><th>Submitted (IST)</th><th>Due / Resolved (IST)</th></tr></thead><tbody>${complaints.map((complaint) => `<tr><td><strong>${escapeHtml(complaint.ticketId)}</strong></td><td><strong>${escapeHtml(complaint.title)}</strong><br><small>${escapeHtml(complaint.category)} · ${escapeHtml(complaint.location)}</small></td><td>${escapeHtml(complaint.student?.fullName || "-")}<br><small>${escapeHtml(complaint.student?.usn || "")}</small></td><td>${escapeHtml(complaint.isAdminOnly ? "Administration" : complaint.department)}</td><td>${escapeHtml(complaint.priority)}</td><td>${escapeHtml(complaint.status)}</td><td>${escapeHtml(formatDate(complaint.submittedAt || complaint.createdAt))}</td><td>Due: ${escapeHtml(formatDate(complaint.dueDate))}<br>Resolved: ${escapeHtml(formatDate(complaint.resolvedAt))}</td></tr>`).join("") || '<tr><td colspan="8">No complaints match the selected report criteria.</td></tr>'}</tbody></table>`;
}

function officialIndividualMarkup(complaint) {
  if (!complaint) return "";
  const history = [...(complaint.history || [])].sort((left, right) => new Date(left.changedAt) - new Date(right.changedAt));
  return `<section class="individual-report"><h2>Complaint information</h2><div class="official-detail-grid"><p><strong>Ticket ID</strong>${escapeHtml(complaint.ticketId)}</p><p><strong>Current status</strong>${escapeHtml(complaint.status)}</p><p><strong>Student</strong>${escapeHtml(complaint.student?.fullName || "-")}<br>${escapeHtml(complaint.student?.usn || "")}</p><p><strong>Department</strong>${escapeHtml(complaint.isAdminOnly ? "Administration" : complaint.department)}</p><p><strong>Category</strong>${escapeHtml(complaint.category)}</p><p><strong>Priority</strong>${escapeHtml(complaint.priority)}</p><p><strong>Submitted</strong>${escapeHtml(formatDate(complaint.submittedAt || complaint.createdAt))}</p><p><strong>Expected resolution</strong>${escapeHtml(formatDate(complaint.dueDate))}</p><p><strong>Assigned staff</strong>${escapeHtml(complaint.assignedTo?.fullName || "Not assigned")}</p><p><strong>Location</strong>${escapeHtml(complaint.location)}</p></div><section class="official-copy-block"><h3>Complaint description</h3><p>${escapeHtml(complaint.description)}</p></section>${complaint.resolutionNote ? `<section class="official-copy-block"><h3>Resolution details</h3><p>${escapeHtml(complaint.resolutionNote)}</p></section>` : ""}<h2>Complaint activity history</h2><table class="official-table official-history-table"><thead><tr><th>Date and time (IST)</th><th>Status</th><th>Action / remark</th><th>Updated by</th></tr></thead><tbody>${history.map((item) => `<tr><td>${escapeHtml(formatDate(item.changedAt))}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.note || "Status updated.")}</td><td>${escapeHtml(item.changedBy?.fullName || "Portal system")}</td></tr>`).join("") || '<tr><td colspan="4">No activity history is available.</td></tr>'}</tbody></table></section>`;
}

function officialHistoryMarkup(complaints) {
  const historyRows = complaints.flatMap((complaint) =>
    (complaint.history || []).map((item) => ({ complaint, item }))
  ).sort((left, right) => new Date(left.item.changedAt) - new Date(right.item.changedAt));
  return `<section class="official-history"><h2>Recorded activity history</h2><table class="official-table official-history-table"><thead><tr><th>Ticket ID</th><th>Date and time (IST)</th><th>Status</th><th>Recorded action</th></tr></thead><tbody>${historyRows.map(({ complaint, item }) => `<tr><td>${escapeHtml(complaint.ticketId)}</td><td>${escapeHtml(formatDate(item.changedAt))}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.note || "Status updated.")}</td></tr>`).join("") || '<tr><td colspan="4">No activity history is available.</td></tr>'}</tbody></table></section>`;
}

function officialDepartmentSummaryMarkup(summary) {
  return `<section class="official-department-summary"><h2>Department performance summary</h2><table class="official-table"><thead><tr><th>Department</th><th>Total</th><th>Open</th><th>Resolved</th><th>Overdue</th></tr></thead><tbody>${(summary.departmentStats || []).map((item) => `<tr><td>${escapeHtml(item.department)}</td><td>${Number(item.total || 0)}</td><td>${Number(item.open || 0)}</td><td>${Number(item.resolved || 0)}</td><td>${Number(item.overdue || 0)}</td></tr>`).join("")}</tbody></table></section>`;
}

function officialReportStyles(orientation) {
  return `<style>@page{size:A4 ${orientation};margin:14mm 12mm 25mm 12mm;@bottom-center{content:"Page " counter(page) " of " counter(pages);font:9px Arial;color:#555}}*{box-sizing:border-box}body{color:#101820;font:11px/1.45 Arial,sans-serif;margin:0}.official-document{max-width:100%;margin:0 auto}.official-header{align-items:center;border-bottom:2px solid #0a365e;display:grid;gap:14px;grid-template-columns:66px 1fr;padding-bottom:12px}.official-header img{height:62px;max-width:62px;object-fit:contain;width:62px}.official-college-name{color:#0a365e;font-size:16px;font-weight:800;letter-spacing:.25px;line-height:1.25}.official-portal-name{color:#354e66;font-size:10px;font-weight:700;letter-spacing:1.2px;margin-top:4px}.official-document-title{border-bottom:1px solid #97aebf;color:#111;font-size:15px;font-weight:800;letter-spacing:.3px;margin:15px 0 0;padding:0 0 8px;text-align:center;text-transform:uppercase}.official-meta{display:flex;gap:24px;justify-content:space-between;margin:12px 0}.official-meta p{margin:0}.official-summary{display:grid;gap:7px;grid-template-columns:repeat(4,1fr);margin:13px 0 16px}.official-summary article{border:1px solid #aebdca;min-height:48px;padding:7px}.official-summary span{color:#3a4e60;display:block;font-size:8.5px;font-weight:700;text-transform:uppercase}.official-summary strong{color:#0b355d;display:block;font-size:13px;margin-top:4px}.official-table{border-collapse:collapse;font-size:8.5px;margin:10px 0 18px;width:100%}.official-table th{background:#e7eef4;color:#111;font-weight:700}.official-table td,.official-table th{border:1px solid #8da0af;padding:6px;text-align:left;vertical-align:top}.official-table thead{display:table-header-group}.official-table tr{break-inside:avoid;page-break-inside:avoid}.official-table small{color:#435568;font-size:8px}.individual-report h2,.official-history h2,.official-department-summary h2{color:#0a365e;font-size:13px;margin:18px 0 8px}.official-detail-grid{display:grid;gap:7px;grid-template-columns:repeat(3,1fr)}.official-detail-grid p{border:1px solid #b7c5d0;margin:0;min-height:47px;padding:7px}.official-detail-grid strong{color:#0a365e;display:block;font-size:8.5px;text-transform:uppercase}.official-copy-block{border:1px solid #b7c5d0;margin-top:10px;padding:9px}.official-copy-block h3{font-size:10px;margin:0 0 4px}.official-copy-block p{margin:0;white-space:pre-wrap}.principal-signature{break-inside:avoid;page-break-inside:avoid;margin-top:28px;min-height:150px}.principal-signature h2{font-size:12px;margin:0 0 4px}.principal-signature p{margin:0}.signature-space{height:42px}.signature-lines{display:grid;gap:9px;grid-template-columns:1fr 1fr;margin-top:10px}.signature-line{border-bottom:1px solid #111;min-height:23px;padding-bottom:3px}.seal-line{border-bottom:1px solid #111;min-height:42px}.print-footer{bottom:6mm;color:#555;font-size:8px;left:12mm;position:fixed;right:12mm;text-align:center}.print-footer .page-count:after{content:"Page " counter(page) " of " counter(pages)}.no-print{margin-top:18px;text-align:center}@media print{.no-print{display:none}.official-document{width:100%}}@media screen{body{background:#eef3f7;padding:24px}.official-document{background:#fff;box-shadow:0 5px 22px rgba(0,0,0,.15);max-width:${orientation === "landscape" ? "1120px" : "800px"};padding:38px}}</style>`;
}

async function generateOfficialReport(form) {
  if (!currentUser || currentUser.role !== "admin") {
    throw new Error("Administrator access is required.");
  }
  const { type, params } = getOfficialReportRequest();

  // Open synchronously from the form action so ordinary popup blockers do
  // not prevent the administrator from using the official print dialog.
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    throw new Error("Allow pop-ups for this site to open the official report.");
  }
  reportWindow.document.write("<title>Preparing official BGMIT report…</title><p style='font:16px Arial;padding:28px'>Preparing secure official report…</p>");
  reportWindow.document.close();

  try {
    const response = await api(`/admin/official-reports/${encodeURIComponent(type)}?${params.toString()}`);
    const report = response.report;
    const orientation = type === "individual" ? "portrait" : "landscape";
    const logoUrl = new URL("/assets/images/logo.png", window.location.origin).href;
    const summary = report.summary || {};
    const details = type === "individual" ? officialIndividualMarkup(report.complaints?.[0]) : "";
    const history = type === "history" ? officialHistoryMarkup(report.complaints || []) : "";
    const departmentSummary = ["department", "analytics"].includes(type)
      ? officialDepartmentSummaryMarkup(summary)
      : "";
    const criteria = [
      report.filters?.department ? `Department: ${report.filters.department === "ADMIN" ? "Administration" : report.filters.department}` : "Department: All",
      `Period: ${officialDateLabel(report.filters?.from)} to ${officialDateLabel(report.filters?.to)}`
    ].join(" | ");

    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>${officialReportStyles(orientation)}</head><body><main class="official-document"><header class="official-header"><img src="${escapeHtml(logoUrl)}" alt="BGMIT logo"><div><div class="official-college-name">BASAVESHWAR GURUKULAM INSTITUTE OF TECHNOLOGY (BGMIT), MUDHOL</div><div class="official-portal-name">SMART COLLEGE COMPLAINT PORTAL · OFFICIAL ADMINISTRATIVE DOCUMENT</div></div></header><h1 class="official-document-title">${escapeHtml(report.title)}</h1><section class="official-meta"><p><strong>Report criteria:</strong> ${escapeHtml(criteria)}</p><p><strong>Generated:</strong> ${escapeHtml(formatDate(report.generatedAt))}</p></section>${officialSummaryMarkup(summary)}${details}${type !== "individual" ? `<section><h2 class="official-document-title">Complaint Register</h2>${officialComplaintTableMarkup(report.complaints || [])}</section>` : ""}${history}${departmentSummary}<section class="principal-signature"><h2>PRINCIPAL</h2><p>Basaveshwar Gurukulam Institute of Technology (BGMIT), Mudhol</p><div class="signature-space"></div><div class="signature-lines"><div class="signature-line">Signature:</div><div class="signature-line">Date:</div></div><div class="seal-line">Official Seal:</div></section><p class="no-print">Use your browser print dialog to select <strong>Save as PDF</strong>. This document intentionally leaves signature and seal fields blank for physical authorization.</p></main><footer class="print-footer">BGMIT Smart College Complaint Portal · <span class="page-count"></span></footer><script>window.onload=function(){window.print()}<\/script></body></html>`);
    reportWindow.document.close();
    $("#dialogOverlay")?.remove();
  } catch (error) {
    reportWindow.close();
    throw error;
  }
}

async function downloadOfficialExcelReport() {
  if (!currentUser || currentUser.role !== "admin") {
    throw new Error("Administrator access is required.");
  }
  const { type, params } = getOfficialReportRequest();
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(
    `${API_BASE}/admin/official-reports/${encodeURIComponent(type)}.xlsx?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Could not download the official Excel report.");
  }
  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `bgmit-official-${type}-report.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

// Status badge CSS class.
function statusClass(status) {
  const map = {
    Submitted: "submitted",
    Assigned: "assigned",
    "In Progress": "progress",
    Resolved: "resolved",
    Closed: "closed",
    Rejected: "rejected",
    Reopened: "reopened"
  };

  return map[status] || "submitted";
}

// Date/time shown professionally.
function formatDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

// Handle every form.
document.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (event.target.id === "loginForm") {
      const data = await api(loginEndpoint(), {
        method: "POST",
        body: {
          email: $("#loginEmail").value.trim(),
          password: $("#loginPassword").value
        }
      });

      saveSession(data);

      event.target.reset();

      showToast(`Welcome, ${currentUser.fullName}!`);

      showPage(currentUser.role === "admin" ? "admin" : currentUser.role === "department" ? "department" : "dashboard");
    }

    if (event.target.id === "passwordResetForm") {
      const form = event.target;
      const submit = $("#resetSubmit");
      const stage = form.dataset.stage || "email";
      submit.disabled = true;
      submit.innerHTML = stage === "email"
        ? '<i class="fa-solid fa-spinner fa-spin"></i> Sending secure OTP…'
        : '<i class="fa-solid fa-spinner fa-spin"></i> Please wait…';

      try {
        if (stage === "email") {
          const result = await api("/auth/password-reset/request", { method: "POST", body: { email: $("#resetEmail").value.trim(), portal: loginRole } });
          form.dataset.stage = "otp";
          $("#resetEmail").disabled = true;
          $("#resetOtp").required = true;
          $("#resetOtpFields").classList.remove("hidden");
          $("#resetInstruction").textContent = "Enter the six-digit verification code sent to your registered email. Check Inbox, Spam and Promotions.";
          submit.textContent = "Verify OTP";
          startResetCooldown(Number(result.resendAfterSeconds) || 60);
          startResetExpiryCountdown(5 * 60);
          showToast(result.otpDispatched
            ? "Verification code sent. Check Inbox, Spam and Promotions."
            : "If the account is registered, check Inbox, Spam and Promotions.");
        } else if (stage === "otp") {
          const verified = await api("/auth/password-reset/verify", { method: "POST", body: { email: $("#resetEmail").value.trim(), portal: loginRole, otp: $("#resetOtp").value.trim() } });
          form.dataset.stage = "password";
          form.dataset.resetToken = verified.resetToken;
          $("#resetOtp").required = false;
          $("#resetOtpFields").classList.add("hidden");
          $("#resetResendButton").classList.add("hidden");
          $("#resetCooldown").textContent = "OTP verified successfully.";
          $("#resetInstruction").textContent = "Create a strong new password for your account.";
          $("#resetPasswordFields").classList.remove("hidden");
          $("#resetNewPassword").required = true;
          $("#resetConfirmPassword").required = true;
          submit.textContent = "Reset Password";
          window.clearInterval(window.resetOtpExpiryTimer);
          addPasswordToggles($("#passwordResetOverlay"));
        } else {
          const newPassword = $("#resetNewPassword").value;
          const confirmPassword = $("#resetConfirmPassword").value;
          if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            throw new Error("Use at least 8 characters, including a letter and a number.");
          }
          if (newPassword !== confirmPassword) {
            throw new Error("New password and confirmation do not match.");
          }
          await api("/auth/password-reset/reset", { method: "POST", body: { resetToken: form.dataset.resetToken, newPassword, confirmPassword } });
          $("#passwordResetOverlay")?.remove();
          window.clearInterval(window.resetOtpExpiryTimer);
          showToast("Your password has been reset successfully! Please log in.");
        }
      } finally {
        if (document.body.contains(submit)) {
          submit.disabled = false;
          const buttonLabels = {
            email: "Send OTP",
            otp: "Verify OTP",
            password: "Reset Password"
          };
          submit.textContent = buttonLabels[form.dataset.stage || stage];
        }
      }
    }

    if (event.target.id === "profileForm") {
      const data = await api("/auth/profile", {
        method: "PATCH",
        body: {
          fullName: $("#profileFullName").value.trim(),
          phone: $("#profilePhone").value.trim(),
          semester: $("#profileSemester")?.value.trim() || "",
          bio: $("#profileBio").value.trim()
        }
      });
      currentUser = data.user;
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      updateHeader();
      $("#dialogOverlay")?.remove();
      showToast("Profile updated successfully.");
      if (currentUser.role === "student") loadStudentDashboard();
      if (currentUser.role === "department") loadDepartmentDashboard();
      if (currentUser.role === "admin") loadAdminDashboard();
    }

    if (event.target.id === "changePasswordForm") {
      await api("/auth/change-password", {
        method: "PATCH",
        body: {
          currentPassword: $("#currentPassword").value,
          newPassword: $("#newPassword").value,
          confirmPassword: $("#confirmPassword").value
        }
      });
      event.target.reset();
      showToast("Password changed successfully.");
    }

    if (event.target.id === "registerForm") {
      const data = await api("/auth/register", {
        method: "POST",
        body: {
          fullName: $("#registerName").value.trim(),
          email: $("#registerEmail").value.trim(),
          usn: $("#registerUsn").value.trim(),
          department: $("#registerDepartment").value.trim(),
          semester: $("#registerSemester").value,
          password: $("#registerPassword").value
        }
      });

      saveSession(data);

      event.target.reset();

      showToast("Student account created successfully.");

      showPage("dashboard");
    }

    if (event.target.id === "complaintForm") {
      await submitComplaint(event.target);
    }

    if (event.target.id === "trackForm") {
      await trackComplaint(event.target);
    }

    if (event.target.id === "assignComplaintForm") {
      const complaintId = $("#assignComplaintId").value;

      await api(`/admin/complaints/${complaintId}/assign`, {
        method: "PATCH",
        body: {
          department: $("#assignDepartment").value,
          assignedTo: $("#assignStaff").value,
          note: $("#assignNote").value.trim()
        }
      });

      showToast("Department assigned successfully.");

      await loadAdminDashboard();
      await manageComplaint(complaintId);
    }

    if (event.target.id === "priorityComplaintForm") {
      const complaintId = $("#priorityComplaintId").value;
      await api(`/admin/complaints/${complaintId}/priority`, {
        method: "PATCH",
        body: {
          priority: $("#prioritySelect").value,
          dueDate: $("#priorityDueDate").value
        }
      });
      showToast("Priority and due date updated.");
      await loadAdminDashboard();
      await manageComplaint(complaintId);
    }

    if (event.target.id === "updateStatusForm") {
      const complaintId = $("#statusComplaintId").value;

      const formData = new FormData();

      formData.append("status", $("#statusSelect").value);
      formData.append("note", $("#statusNote").value.trim());

      const afterPhoto = $("#afterPhoto").files[0];

      if (afterPhoto) {
        formData.append("afterPhoto", afterPhoto);
      }

      await api(`/admin/complaints/${complaintId}/status`, {
        method: "PATCH",
        body: formData
      });

      showToast("Complaint status updated successfully.");

      await loadAdminDashboard();
      await manageComplaint(complaintId);
    }

    if (event.target.id === "departmentAssignWorkForm") {
      const complaintId = $("#departmentAssignComplaintId").value;
      await api(`/department/complaints/${complaintId}/assign-work`, {
        method: "POST",
        body: {
          assignedTo: $("#departmentAssignedTo").value,
          workDescription: $("#departmentWorkDescription").value.trim(),
          dueDate: $("#departmentWorkDueDate").value
        }
      });
      showToast("Work assigned successfully.");
      await loadDepartmentDashboard();
      await openDepartmentComplaint(complaintId);
    }

    if (event.target.id === "departmentStatusForm") {
      const complaintId = $("#departmentStatusComplaintId").value;
      const formData = new FormData();
      formData.append("status", $("#departmentStatus").value);
      formData.append("note", $("#departmentStatusNote").value.trim());
      const afterPhoto = $("#departmentAfterPhoto").files[0];
      if (afterPhoto) formData.append("afterPhoto", afterPhoto);
      await api(`/department/complaints/${complaintId}/status`, {
        method: "PATCH",
        body: formData
      });
      showToast("Complaint status updated successfully.");
      await loadDepartmentDashboard();
      await openDepartmentComplaint(complaintId);
    }

    if (event.target.id === "departmentRemarkForm") {
      const complaintId = $("#departmentRemarkComplaintId").value;
      await api(`/department/complaints/${complaintId}/remarks`, {
        method: "POST",
        body: { remark: $("#departmentRemark").value.trim() }
      });
      showToast("Department remark added.");
      await openDepartmentComplaint(complaintId);
    }

    if (event.target.id === "adminUserForm") {
      const userId = $("#adminUserId").value;
      const body = {
        fullName: $("#adminUserName").value.trim(),
        email: $("#adminUserEmail").value.trim(),
        role: $("#adminUserRole").value,
        department: $("#adminUserDepartment").value,
        phone: $("#adminUserPhone").value.trim(),
        isActive: $("#adminUserActive").checked
      };
      const password = $("#adminUserPassword").value;
      if (password) body.password = password;
      if (userId) {
        await api(`/admin/users/${userId}`, { method: "PATCH", body });
        showToast("User account updated successfully.");
      } else {
        await api("/admin/users", { method: "POST", body: { ...body, password } });
        showToast("User account created successfully.");
      }
      await openAdminPanel(body.role === "student" ? "students" : "staff");
    }

    if (event.target.id === "adminNoticeForm") {
      await api("/notices", {
        method: "POST",
        body: {
          title: $("#noticeTitle").value.trim(),
          message: $("#noticeMessage").value.trim(),
          audience: $("#noticeAudience").value,
          isPinned: $("#noticePinned").checked,
          isActive: true
        }
      });
      showToast("Campus notice published.");
      await openAdminPanel("notices");
      await loadPublicNotices();
    }

    if (event.target.id === "adminCategoryForm") {
      await api("/admin/categories", {
        method: "POST",
        body: {
          name: $("#adminCategoryName").value.trim(),
          department: $("#adminCategoryDepartment").value,
          description: $("#adminCategoryDescription").value.trim(),
          isAdminOnly: $("#adminCategoryAdminOnly").checked
        }
      });
      showToast("Complaint category created.");
      await loadCategories();
      await openAdminPanel("categories");
    }

    if (event.target.id === "adminCategoryEditForm") {
      await api(`/admin/categories/${encodeURIComponent($("#editCategoryId").value)}`, {
        method: "PATCH",
        body: {
          name: $("#editCategoryName").value.trim(),
          department: $("#editCategoryDepartment").value,
          description: $("#editCategoryDescription").value.trim(),
          isAdminOnly: $("#editCategoryAdminOnly").checked,
          isStudentVisible: $("#editCategoryStudentVisible").checked,
          isActive: $("#editCategoryActive").checked
        }
      });
      showToast("Complaint category updated.");
      await loadCategories();
      await openAdminPanel("categories");
    }

    if (event.target.id === "adminSettingsForm") {
      await api("/admin/settings", {
        method: "PATCH",
        body: {
          portalName: $("#settingPortalName").value.trim(),
          supportEmail: $("#settingSupportEmail").value.trim(),
          maintenanceMessage: $("#settingMaintenanceMessage").value.trim(),
          monthlyComplaintLimit: Number($("#settingMonthlyComplaintLimit").value),
          defaultComplaintPriority: $("#settingDefaultComplaintPriority").value
        }
      });
      showToast("Portal settings saved.");
    }

    if (event.target.id === "adminNotificationForm") {
      const role = $("#adminNotificationRole").value;
      const department = $("#adminNotificationDepartment").value;
      if (department && role && role !== "department") {
        throw new Error("Department targeting is available only for Department staff notifications.");
      }
      await api("/admin/notifications", {
        method: "POST",
        body: {
          message: $("#adminNotificationMessage").value.trim(),
          role,
          department
        }
      });
      showToast("Notification sent successfully.");
      $("#adminNotificationMessage").value = "";
    }

    if (event.target.id === "adminDepartmentForm") {
      await api(`/admin/departments/${encodeURIComponent($("#editDepartmentCode").value)}`, {
        method: "PATCH",
        body: {
          name: $("#editDepartmentName").value.trim(),
          description: $("#editDepartmentDescription").value.trim(),
          isActive: $("#editDepartmentActive").checked
        }
      });
      showToast("Department updated successfully.");
      await openAdminPanel("departments");
    }

    if (event.target.id === "officialReportForm") {
      const submit = event.target.querySelector('button[type="submit"]');
      const originalMarkup = submit?.innerHTML;
      if (submit) {
        submit.disabled = true;
        submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing official report…';
      }
      try {
        await generateOfficialReport(event.target);
        showToast("Official report prepared. Choose Print or Save as PDF.");
      } finally {
        if (submit && document.body.contains(submit)) {
          submit.disabled = false;
          submit.innerHTML = originalMarkup;
        }
      }
    }
  } catch (error) {
    showToast(error.message, "error");
  }
});

// Handle buttons and navigation.
document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-password-target]");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.passwordTarget);
    if (input) {
      input.type = input.type === "password" ? "text" : "password";
      toggle.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
      const icon = toggle.querySelector("i");
      if (icon) icon.className = input.type === "password" ? "fa-regular fa-eye" : "fa-regular fa-eye-slash";
    }
    return;
  }

  const portalLogin = event.target.closest("[data-portal-login]");
  if (portalLogin) {
    event.preventDefault();
    openPortalLogin(portalLogin.dataset.portalLogin);
    return;
  }

  const secureFile = event.target.closest("[data-secure-file]");
  if (secureFile) {
    try {
      await openProtectedFile(
        secureFile.dataset.secureFile,
        secureFile.dataset.secureFileName
      );
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  if (event.target.closest("#forgotPasswordButton")) {
    openPasswordReset();
    return;
  }
  if (event.target.closest("#resetResendButton")) {
    const resend = $("#resetResendButton");
    let sent = false;
    try {
      resend.disabled = true;
      resend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
      const result = await api("/auth/password-reset/request", {
        method: "POST",
        body: { email: $("#resetEmail").value.trim(), portal: loginRole }
      });
      startResetCooldown(Number(result.resendAfterSeconds) || 60);
      startResetExpiryCountdown(5 * 60);
      sent = Boolean(result.otpDispatched);
      showToast(result.otpDispatched
        ? "New verification code sent. Check Inbox, Spam and Promotions."
        : "Please wait for the current verification code. No duplicate email was sent.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      if (document.body.contains(resend)) {
        resend.textContent = "Resend OTP";
        if (!sent) resend.disabled = false;
      }
    }
    return;
  }
  if (event.target.closest("#resetChangeEmail")) {
    returnToResetEmailStage();
    return;
  }
  if (event.target.closest("[data-close-password-reset]")) {
    window.clearInterval(window.resetOtpExpiryTimer);
    window.clearInterval(window.resetCooldownTimer);
    $("#passwordResetOverlay")?.remove();
    return;
  }
  const pageButton = event.target.closest("[data-page]");

  if (pageButton) {
    event.preventDefault();

    if (pageButton.classList.contains("logout-button")) {
      logout();
      return;
    }

    showPage(pageButton.dataset.page);
    return;
  }

  const manageButton = event.target.closest("[data-manage-id]");

  if (manageButton) {
    try {
      await manageComplaint(manageButton.dataset.manageId);
    } catch (error) {
      showToast(error.message, "error");
    }

    return;
  }

  if (event.target.closest("#applyAdminFilters")) {
    try {
      await filterAdminComplaints();
    } catch (error) {
      showToast(error.message, "error");
    }

    return;
  }

  if (event.target.closest("#applyStudentComplaintFilters")) {
    try {
      await loadStudentComplaintHistory();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (event.target.closest("#applyDepartmentFilters")) {
    try {
      await loadDepartmentComplaints();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const departmentComplaint = event.target.closest("[data-department-complaint]");
  if (departmentComplaint) {
    try {
      await openDepartmentComplaint(departmentComplaint.dataset.departmentComplaint);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const acceptComplaint = event.target.closest("[data-accept-complaint]");
  if (acceptComplaint) {
    try {
      const complaintId = acceptComplaint.dataset.acceptComplaint;
      await api(`/department/complaints/${complaintId}/accept`, { method: "POST" });
      showToast("Your department accepted this complaint.");
      await loadDepartmentDashboard();
      await openDepartmentComplaint(complaintId);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (event.target.closest("[data-profile]")) {
    openProfileDialog();
    return;
  }

  const studentComplaint = event.target.closest("[data-student-complaint]");
  if (studentComplaint) {
    try {
      await openStudentComplaint(studentComplaint.dataset.studentComplaint);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (event.target.closest("[data-department-work]")) {
    try {
      await openDepartmentWorkAssignments();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const departmentScroll = event.target.closest("[data-department-scroll]");
  if (departmentScroll) {
    document.getElementById(departmentScroll.dataset.departmentScroll)?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const adminScroll = event.target.closest("[data-admin-scroll]");
  if (adminScroll) {
    document.getElementById(adminScroll.dataset.adminScroll)?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  const adminAction = event.target.closest("[data-admin-action]");
  if (adminAction) {
    try {
      await openAdminPanel(adminAction.dataset.adminAction);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const createAdminUser = event.target.closest("[data-create-admin-user]");
  if (createAdminUser) {
    openAdminUserEditor("", createAdminUser.dataset.createAdminUser);
    return;
  }

  const editAdminUser = event.target.closest("[data-edit-admin-user]");
  if (editAdminUser) {
    openAdminUserEditor(editAdminUser.dataset.editAdminUser);
    return;
  }

  const editCategory = event.target.closest("[data-edit-category]");
  if (editCategory) {
    openAdminCategoryEditor(editCategory);
    return;
  }

  const deactivateUser = event.target.closest("[data-deactivate-user]");
  if (deactivateUser) {
    try {
      await api(`/admin/users/${deactivateUser.dataset.deactivateUser}`, { method: "DELETE" });
      showToast("User account deactivated.");
      await openAdminPanel(deactivateUser.dataset.adminPanel || "staff");
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const deleteNotice = event.target.closest("[data-delete-notice]");
  if (deleteNotice) {
    try {
      await api(`/notices/${deleteNotice.dataset.deleteNotice}`, { method: "DELETE" });
      showToast("Notice deleted.");
      await openAdminPanel("notices");
      await loadPublicNotices();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  const editDepartment = event.target.closest("[data-edit-department]");
  if (editDepartment) {
    openDepartmentEditor(
      editDepartment.dataset.editDepartment,
      editDepartment.dataset.departmentName,
      editDepartment.dataset.departmentDescription,
      editDepartment.dataset.departmentActive
    );
    return;
  }

  if (event.target.closest("#downloadCsvButton")) {
    try {
      await downloadCsv();
      showToast("Excel-ready CSV report downloaded.");
    } catch (error) {
      showToast(error.message, "error");
    }

    return;
  }

  if (event.target.closest("#downloadOfficialExcelButton")) {
    try {
      const button = event.target.closest("#downloadOfficialExcelButton");
      const originalMarkup = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Preparing…';
      await downloadOfficialExcelReport();
      showToast("Official Excel report downloaded.");
      button.disabled = false;
      button.innerHTML = originalMarkup;
    } catch (error) {
      showToast(error.message, "error");
      const button = $("#downloadOfficialExcelButton");
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fa-solid fa-file-excel"></i> Download Official Excel';
      }
    }
    return;
  }

  if (event.target.closest("#printAdminReportButton")) {
    openOfficialPrintCentre();
    return;
  }

  if (event.target.closest("[data-close-notifications]")) {
    $("#notificationOverlay")?.remove();
    return;
  }

  if (event.target.closest("#readAllButton")) {
    try {
      await api("/notifications/read-all", {
        method: "PATCH"
      });

      $("#notificationOverlay")?.remove();

      await loadStudentDashboard();

      showToast("All notifications marked as read.");
    } catch (error) {
      showToast(error.message, "error");
    }

    return;
  }

  const notification = event.target.closest(
    "[data-notification-id]"
  );

  if (notification) {
    try {
      await api(
        `/notifications/${notification.dataset.notificationId}/read`,
        {
          method: "PATCH"
        }
      );

      notification.classList.remove("unread");

      await loadStudentDashboard();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});

// Handle dashboard side menu.
document.addEventListener("click", async (event) => {
  const dashboardButton = event.target.closest(
    "[data-dashboard]"
  );

  if (!dashboardButton) return;

  event.preventDefault();

  const action = dashboardButton.dataset.dashboard;

  if (action === "notifications") {
    try {
      await openNotifications();
    } catch (error) {
      showToast(error.message, "error");
    }

    return;
  }

  if (action === "complaints") {
    $(".recent-card")?.scrollIntoView({
      behavior: "smooth"
    });

    return;
  }

  if (action === "feedback") {
    showToast(
      "Feedback appears after your complaint is resolved."
    );
  }
});

// Mobile menu.
$("#menuButton")?.addEventListener("click", () => {
  $("#mainNav")?.classList.toggle("open");
});

// Validate evidence files and reveal category-specific complaint fields.
document.addEventListener("change", (event) => {
  if (event.target.id === "officialReportType") {
    syncOfficialReportFields();
    return;
  }

  if (event.target.id === "assignDepartment") {
    loadAdminStaffOptions(event.target.value).catch((error) => showToast(error.message, "error"));
    return;
  }

  if (event.target.id === "category") {
    toggleBusFields();
    checkSimilarComplaints();
    return;
  }

  if (["title", "description", "location"].includes(event.target.id)) {
    window.clearTimeout(window.similarComplaintTimer);
    window.similarComplaintTimer = window.setTimeout(checkSimilarComplaints, 500);
    return;
  }

  if (event.target.id === "photo") {
    const file = event.target.files[0];
    $("#photoPreview")?.remove();
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("Upload JPG, PNG or WEBP image only.", "error");
      event.target.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast("Photo must be less than 5 MB.", "error");
      event.target.value = "";
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    event.target.insertAdjacentHTML("afterend", `<img id="photoPreview" class="photo-preview" src="${previewUrl}" alt="Selected complaint photo preview">`);
    return;
  }

  if (event.target.id === "attachments") {
    const files = Array.from(event.target.files || []);
    const validTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (files.length > 3 || files.some((file) => !validTypes.includes(file.type) || file.size > 5 * 1024 * 1024)) {
      showToast("Choose up to 3 JPG, PNG, WEBP, or PDF files, each under 5 MB.", "error");
      event.target.value = "";
      return;
    }
    showToast(`${files.length} attachment(s) ready to upload.`);
  }
});

// React when browser URL hash changes.
window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "");

  if (page) {
    showPage(page, false);
  }
});

window.addEventListener("popstate", () => {
  const page = window.location.hash.replace("#", "") ||
    (window.location.pathname === "/about" ? "about" : "home");
  showPage(page, false);
});

// Verify saved login token when website opens.
async function validateSavedSession() {
  if (!localStorage.getItem(TOKEN_KEY)) return;

  try {
    const data = await api("/auth/me");

    currentUser = data.user;

    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));

    updateHeader();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);

    currentUser = null;

    updateHeader();
  }
}

// Start website.
async function startPortal() {
  createExtraPages();
  addPasswordToggles();
  configureLoginPortal();

  updateHeader();

  await Promise.all([loadCategories(), loadPublicNotices()]);
  await validateSavedSession();

  const startingPage = window.location.hash.replace("#", "") ||
    (window.location.pathname === "/about"
      ? "about"
      : window.location.pathname !== "/"
        ? "login"
        : "home");

  showPage(startingPage, false);
}

startPortal();

function openFeedbackDialog(complaintId, ticketId) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div class="notification-overlay" id="dialogOverlay">
      <div class="notification-drawer">
        <div class="drawer-header">
          <h2>Feedback: ${escapeHtml(ticketId)}</h2>
          <button class="icon-button" data-close-dialog>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <form id="feedbackForm">
          <input type="hidden" id="feedbackComplaintId" value="${complaintId}">

          <label for="feedbackRating">Rate the resolution</label>
          <select id="feedbackRating" required>
            <option value="">Select rating</option>
            <option value="5">5 - Excellent</option>
            <option value="4">4 - Good</option>
            <option value="3">3 - Average</option>
            <option value="2">2 - Poor</option>
            <option value="1">1 - Very Poor</option>
          </select>

          <label for="feedbackComment">Comment</label>
          <textarea id="feedbackComment" rows="5"
            placeholder="Write your feedback about the solution."></textarea>

          <button class="button button-primary full-button" type="submit">
            Submit Feedback
          </button>
        </form>
      </div>
    </div>
    `
  );
}

function openReopenDialog(complaintId, ticketId) {
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div class="notification-overlay" id="dialogOverlay">
      <div class="notification-drawer">
        <div class="drawer-header">
          <h2>Reopen: ${escapeHtml(ticketId)}</h2>
          <button class="icon-button" data-close-dialog>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <form id="reopenForm">
          <input type="hidden" id="reopenComplaintId" value="${complaintId}">

          <label for="reopenReason">Why is the issue not resolved?</label>
          <textarea id="reopenReason" rows="5" required
            placeholder="Explain what is still wrong."></textarea>

          <button class="button button-primary full-button" type="submit">
            Reopen Complaint
          </button>
        </form>
      </div>
    </div>
    `
  );
}

document.addEventListener("click", async (event) => {
  const feedbackButton = event.target.closest("[data-feedback-id]");

  if (feedbackButton) {
    openFeedbackDialog(
      feedbackButton.dataset.feedbackId,
      feedbackButton.dataset.ticketId
    );
  }

  const reopenButton = event.target.closest("[data-reopen-id]");

  if (reopenButton) {
    openReopenDialog(
      reopenButton.dataset.reopenId,
      reopenButton.dataset.ticketId
    );
  }

  const trackButton = event.target.closest("[data-track-ticket]");

  if (trackButton) {
    $("#trackId").value = trackButton.dataset.trackTicket;
    showPage("track");
    await trackComplaint($("#trackForm"));
  }

  if (event.target.closest("[data-close-dialog]")) {
    $("#dialogOverlay")?.remove();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "feedbackForm") {
    event.preventDefault();

    try {
      await api(
        `/complaints/${$("#feedbackComplaintId").value}/feedback`,
        {
          method: "POST",
          body: {
            rating: Number($("#feedbackRating").value),
            comment: $("#feedbackComment").value.trim()
          }
        }
      );

      $("#dialogOverlay")?.remove();
      showToast("Thank you for your feedback.");
      loadStudentDashboard();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  if (event.target.id === "reopenForm") {
    event.preventDefault();

    try {
      await api(
        `/complaints/${$("#reopenComplaintId").value}/reopen`,
        {
          method: "PATCH",
          body: {
            reopenReason: $("#reopenReason").value.trim()
          }
        }
      );

      $("#dialogOverlay")?.remove();
      showToast("Complaint reopened successfully.");
      loadStudentDashboard();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});
