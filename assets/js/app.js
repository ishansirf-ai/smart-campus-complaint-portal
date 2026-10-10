const API_BASE = "/api";

const TOKEN_KEY = "portal_token";
const USER_KEY = "portal_user";

let currentUser = getSavedUser();
let loginRole = ({"/admin-login":"admin","/department-login":"department","/student-login":"student"})[window.location.pathname] || "student";
let adminChart = null;
let departments = [
  "Maintenance Department",
  "Civil / Maintenance Department",
  "IT Department",
  "Housekeeping Department",
  "Laboratory Department",
  "Administration"
];

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

  const response = await fetch(`${API_BASE}${path}`, settings);

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
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
  } else {
    loginButton.textContent = "Login";
    loginButton.dataset.page = "login";
  }
}

// Show selected frontend page.
function showPage(pageName, updateHash = true) {
  const protectedPages = [
    "dashboard",
    "complaint",
    "admin"
  ];

  if (protectedPages.includes(pageName) && !currentUser) {
    showToast("Please log in first.", "error");
    pageName = "login";
  }

  if (pageName === "admin" && (!currentUser || currentUser.role !== "admin")) {
    showToast("Admin or Department login is required.", "error");
    pageName = "login";
  }

  if (pageName === "department" && (!currentUser || currentUser.role !== "department")) {
    showToast("Department staff login is required.", "error");
    pageName = "login";
  }

  if (pageName === "dashboard" && isStaff()) {
    pageName = "admin";
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
    history.replaceState(null, "", `#${pageName}`);
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
  }
}

// Insert Register and Admin pages automatically.
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

          <div class="admin-heading">
            <div>
              <p class="small-title">ADMIN / DEPARTMENT PANEL</p>
              <h1>Complaint Management Dashboard</h1>
              <p id="adminWelcome">Manage, assign and resolve campus complaints.</p>
            </div>

            <button id="downloadCsvButton" class="button button-primary">
              <i class="fa-solid fa-file-csv"></i> Download CSV Report
            </button>
          </div>

          <div class="admin-stat-grid" id="adminStats"></div>

          <div class="admin-filter-row">
            <input id="adminSearch" placeholder="Search ticket, title or location">

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

            <select id="adminOverdueFilter">
              <option value="">All Complaints</option>
              <option value="true">Overdue Only</option>
            </select>

            <button id="applyAdminFilters" class="button button-primary">
              Search
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

          <section class="chart-card">
            <h3>Complaints by Category</h3>
            <canvas id="adminCategoryChart"></canvas>
          </section>
        </div>
      </section>
      `
    );
  }

  if (!$("#departmentPage")) {
    main.insertAdjacentHTML("beforeend", `
      <section class="page admin-page" id="departmentPage">
        <div class="admin-shell">
          <button class="back-button" data-page="home"><i class="fa-solid fa-arrow-left"></i> Home</button>
          <div class="admin-heading"><div><p class="small-title">DEPARTMENT STAFF PORTAL</p><h1>Welcome, <span id="departmentName">Department</span></h1><p>Manage complaints assigned to your department.</p></div></div>
          <div class="admin-stat-grid" id="departmentStats"></div>
          <section class="admin-panel"><h2>Assigned Complaints</h2><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Title</th><th>Priority</th><th>Status</th><th>Due date</th><th>Action</th></tr></thead><tbody id="departmentComplaintRows"></tbody></table></div></section>
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
  document.body.insertAdjacentHTML("beforeend", `<div class="notification-overlay" id="passwordResetOverlay"><div class="notification-drawer"><div class="drawer-header"><h2>Reset password</h2><button class="icon-button" data-close-password-reset><i class="fa-solid fa-xmark"></i></button></div><p>We will email a secure 4-digit OTP to your registered address.</p><form id="passwordResetForm"><label>Email</label><input id="resetEmail" type="email" required><div id="resetOtpFields" class="hidden"><label>4-digit OTP</label><input id="resetOtp" inputmode="numeric" maxlength="4"><label>New password</label><input id="resetNewPassword" type="password" minlength="6"><label>Confirm password</label><input id="resetConfirmPassword" type="password" minlength="6"></div><button class="button button-primary full-button" type="submit" id="resetSubmit">Send OTP</button></form></div></div>`);
  addPasswordToggles();
}

function addPasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.eyeReady) return;
    input.dataset.eyeReady = "true";
    input.insertAdjacentHTML("afterend", `<button type="button" class="password-toggle" data-password-target="${input.id}" aria-label="Show password"><i class="fa-regular fa-eye"></i></button>`);
  });
}

async function loadDepartmentDashboard() {
  if (!currentUser || currentUser.role !== "department") return;
  try {
    const data = await api("/department/dashboard");
    const stats = data.summary || {};
    $("#departmentName").textContent = `${data.department} Department`;
    $("#departmentStats").innerHTML = [
      ["Assigned Complaints", stats.total], ["Pending", stats.pending],
      ["In Progress", stats.inProgress], ["Resolved", stats.resolved], ["Overdue", stats.overdue]
    ].map(([label, value]) => `<article class="stat-card"><p>${label}</p><strong>${Number(value || 0)}</strong></article>`).join("");
    $("#departmentComplaintRows").innerHTML = (data.recentComplaints || []).map((item) => `<tr><td>${escapeHtml(item.ticketId)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.priority)}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${formatDate(item.dueDate)}</td><td><button class="text-button" data-department-complaint="${item._id}">View</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty-state">No complaints assigned to this department.</td></tr>`;
  } catch (error) { showToast(error.message, "error"); }
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

    departments = [
      ...new Set(
        data.categories.map((item) => item.department)
      )
    ];
  } catch (error) {
    showToast(error.message, "error");
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

    $("#progressCount").textContent =
      dashboardData.summary.inProgress;

    $("#resolvedCount").textContent =
      dashboardData.summary.resolved;

    $("#overdueCount").textContent =
      dashboardData.summary.overdue;

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
        <td colspan="6" class="empty-state">
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
          <td>${formatDate(complaint.createdAt)}</td>
          <td>
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
                : `
                  <button class="manage-button"
                    data-track-ticket="${complaint.ticketId}">
                    Track
                  </button>
                `
            }
          </td>
        </tr>
      `;
    })
    .join("");
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
  formData.append("priority", $("#priority").value);
  formData.append(
    "description",
    $("#description").value.trim()
  );

  const photo = $("#photo").files[0];

  if (photo) {
    formData.append("photo", photo);
  }

  const data = await api("/complaints", {
    method: "POST",
    body: formData
  });

  form.reset();

  showToast(
    `Complaint submitted. Save ID: ${data.complaint.ticketId}`
  );

  showPage("dashboard");
}

// Track public complaint by ticket ID.
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

    <p><strong>Category:</strong> ${escapeHtml(complaint.category)}</p>
    <p><strong>Location:</strong> ${escapeHtml(complaint.location)}</p>
    <p><strong>Department:</strong> ${escapeHtml(complaint.department)}</p>
    <p><strong>Priority:</strong> ${escapeHtml(complaint.priority)}</p>

    <p>
      <strong>Status:</strong>
      <span class="status ${statusClass(complaint.status)}">
        ${escapeHtml(complaint.status)}
      </span>
    </p>

    <div class="timeline">
      ${timelineStep("1", "Submitted", complaint.status, 1)}
      ${timelineStep("2", "Assigned", complaint.status, 2)}
      ${timelineStep("3", "In Progress", complaint.status, 3)}
      ${timelineStep("4", "Resolved", complaint.status, 4)}
    </div>

    <div class="photo-grid">
      <div>
        <h4>Issue Photo</h4>
        ${
          complaint.beforePhoto
            ? `<img class="complaint-photo" src="${complaint.beforePhoto}" alt="Issue evidence">`
            : "<p>No issue photo uploaded.</p>"
        }
      </div>

      <div>
        <h4>Resolution Photo</h4>
        ${
          complaint.afterPhoto
            ? `<img class="complaint-photo" src="${complaint.afterPhoto}" alt="Resolution evidence">`
            : "<p>Resolution photo not uploaded yet.</p>"
        }
      </div>
    </div>

    ${
      complaint.resolutionNote
        ? `<p><strong>Resolution Note:</strong> ${escapeHtml(complaint.resolutionNote)}</p>`
        : ""
    }

    <ul class="history-list">
      ${complaint.history
        .map(
          (item) => `
          <li>
            <strong>${escapeHtml(item.status)}</strong><br>
            ${escapeHtml(item.note || "Status updated.")}
            <br>
            <small>${formatDate(item.changedAt)}</small>
          </li>
        `
        )
        .join("")}
    </ul>
  `;
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
  if (!isStaff()) return;

  try {
    const [dashboardData, complaintsData] = await Promise.all([
      api("/admin/dashboard"),
      api("/admin/complaints?limit=20")
    ]);

    $("#adminWelcome").textContent =
      `${currentUser.fullName} — ${currentUser.role === "admin" ? "Administrator" : currentUser.department}`;

    renderAdminStats(dashboardData);
    renderAdminComplaints(complaintsData.complaints);
    drawAdminChart(dashboardData.byCategory);
  } catch (error) {
    showToast(error.message, "error");
  }
}

// Admin count cards.
function renderAdminStats(data) {
  const summary = data.summary;

  $("#adminStats").innerHTML = `
    <article class="admin-stat"><span>Total</span><strong>${summary.total}</strong></article>
    <article class="admin-stat"><span>Submitted</span><strong>${summary.submitted}</strong></article>
    <article class="admin-stat"><span>Assigned</span><strong>${summary.assigned}</strong></article>
    <article class="admin-stat"><span>In Progress</span><strong>${summary.inProgress}</strong></article>
    <article class="admin-stat"><span>Resolved</span><strong>${summary.resolved}</strong></article>
    <article class="admin-stat"><span>Overdue</span><strong>${summary.overdue}</strong></article>
    <article class="admin-stat"><span>Avg. Rating</span><strong>${data.averageFeedbackRating || 0}/5</strong></article>
    <article class="admin-stat"><span>Avg. Resolution</span><strong>${data.averageResolutionHours || 0}h</strong></article>
  `;
}

// Admin complaint table.
function renderAdminComplaints(complaints) {
  const table = $("#adminComplaintRows");

  if (!complaints.length) {
    table.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
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
        <td>${escapeHtml(complaint.department)}</td>
        <td>${escapeHtml(complaint.priority)}</td>
        <td>
          <span class="status ${statusClass(complaint.status)}">
            ${escapeHtml(complaint.status)}
          </span>
        </td>
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

  const departmentOptions = departments
    .map(
      (department) => `
      <option value="${escapeHtml(department)}"
        ${complaint.department === department ? "selected" : ""}>
        ${escapeHtml(department)}
      </option>
    `
    )
    .join("");

  $("#managePanel").innerHTML = `
    <h2>Manage ${escapeHtml(complaint.ticketId)}</h2>

    <div class="manage-info">
      <strong>${escapeHtml(complaint.title)}</strong><br>
      Student: ${escapeHtml(complaint.student?.fullName)}<br>
      Location: ${escapeHtml(complaint.location)}<br>
      Category: ${escapeHtml(complaint.category)}<br>
      Current Status: ${escapeHtml(complaint.status)}
    </div>

    ${
      currentUser.role === "admin"
        ? `
        <form id="assignComplaintForm">
          <input type="hidden" id="assignComplaintId" value="${complaint._id}">

          <label for="assignDepartment">Assign Department</label>
          <select id="assignDepartment">${departmentOptions}</select>

          <label for="assignNote">Assignment Note</label>
          <textarea id="assignNote" rows="3" placeholder="Example: Technician assigned."></textarea>

          <button class="button button-primary full-button" type="submit">
            Assign Department
          </button>
        </form>
        `
        : ""
    }

    <hr style="margin:20px 0; border:0; border-top:1px solid #dce7f0;">

    <form id="updateStatusForm">
      <input type="hidden" id="statusComplaintId" value="${complaint._id}">

      <label for="statusSelect">Update Status</label>
      <select id="statusSelect">
        <option>Assigned</option>
        <option>In Progress</option>
        <option>Resolved</option>
        <option>Closed</option>
        <option>Rejected</option>
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

// Admin category chart.
function drawAdminChart(items) {
  if (!window.Chart) return;

  if (adminChart) {
    adminChart.destroy();
  }

  adminChart = new Chart($("#adminCategoryChart"), {
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

// Search/filter admin complaints.
async function filterAdminComplaints() {
  const params = new URLSearchParams();

  const search = $("#adminSearch").value.trim();
  const status = $("#adminStatusFilter").value;
  const priority = $("#adminPriorityFilter").value;
  const isOverdue = $("#adminOverdueFilter").value;

  if (search) params.set("q", search);
  if (status) params.set("status", status);
  if (priority) params.set("priority", priority);
  if (isOverdue) params.set("isOverdue", isOverdue);

  params.set("limit", "30");

  const data = await api(
    `/admin/complaints?${params.toString()}`
  );

  renderAdminComplaints(data.complaints);
}

// Download CSV complaint report.
async function downloadCsv() {
  const token = localStorage.getItem(TOKEN_KEY);

  const response = await fetch(`${API_BASE}/admin/export`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error("Could not download report.");
  }

  const blob = await response.blob();

  const downloadUrl = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "college-complaint-report.csv";

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
      if (!form.dataset.otpSent) {
        await api("/auth/password-reset/request", { method: "POST", body: { email: $("#resetEmail").value.trim(), portal: loginRole } });
        form.dataset.otpSent = "true";
        $("#resetOtpFields").classList.remove("hidden");
        submit.textContent = "Verify OTP and reset password";
        showToast("If the account exists, the OTP has been sent.");
      } else {
        const verified = await api("/auth/password-reset/verify", { method: "POST", body: { email: $("#resetEmail").value.trim(), portal: loginRole, otp: $("#resetOtp").value.trim() } });
        await api("/auth/password-reset/reset", { method: "POST", body: { resetToken: verified.resetToken, newPassword: $("#resetNewPassword").value, confirmPassword: $("#resetConfirmPassword").value } });
        $("#passwordResetOverlay")?.remove();
        showToast("Password reset successfully. Please log in.");
      }
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
          note: $("#assignNote").value.trim()
        }
      });

      showToast("Department assigned successfully.");

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
  }
  const loginTab = event.target.closest(".login-tab");
  if (loginTab) {
    loginRole = loginTab.dataset.role || "student";
    document.querySelectorAll(".login-tab").forEach((tab) => tab.classList.toggle("active", tab === loginTab));
    return;
  }
  if (event.target.closest("#forgotPasswordButton")) {
    openPasswordReset();
    return;
  }
  if (event.target.closest("[data-close-password-reset]")) {
    $("#passwordResetOverlay")?.remove();
    return;
  }
  const pageButton = event.target.closest("[data-page]");

  if (pageButton) {
    event.preventDefault();

    if (pageButton.dataset.loginRole) {
      loginRole = pageButton.dataset.loginRole;
      document.querySelectorAll(".login-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.role === loginRole));
    }

    if (pageButton.classList.contains("logout-button")) {
      logout();
      return;
    }

    showPage(pageButton.dataset.page);
    return;
  }

  const aboutButton = event.target.closest(
    "[data-scroll='about']"
  );

  if (aboutButton) {
    event.preventDefault();

    showPage("home");

    setTimeout(() => {
      $("#about")?.scrollIntoView({
        behavior: "smooth"
      });
    }, 150);

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

  if (event.target.closest("#downloadCsvButton")) {
    try {
      await downloadCsv();
      showToast("CSV report downloaded.");
    } catch (error) {
      showToast(error.message, "error");
    }

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

// Image preview before upload.
document.addEventListener("change", (event) => {
  if (event.target.id !== "photo") return;

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

  event.target.insertAdjacentHTML(
    "afterend",
    `<img id="photoPreview" class="photo-preview" src="${previewUrl}" alt="Selected complaint photo preview">`
  );
});

// React when browser URL hash changes.
window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "");

  if (page) {
    showPage(page, false);
  }
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

  const loginHeading = $("#loginPage h1");
  const loginDescription = $("#loginPage .auth-card > p");
  if (loginHeading && window.location.pathname !== "/") {
    const labels = { student: "Student Complaint Portal", admin: "Administrator Portal", department: "Department Staff Portal" };
    loginHeading.textContent = labels[loginRole] || labels.student;
    if (loginDescription) loginDescription.textContent = `Sign in to the ${labels[loginRole] || labels.student}.`;
    document.querySelectorAll(".login-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.role === loginRole));
  }

  updateHeader();

  await loadCategories();
  await validateSavedSession();

  const startingPage = window.location.hash.replace("#", "") || (window.location.pathname !== "/" ? "login" : "home");

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
