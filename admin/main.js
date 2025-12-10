// --- main.js (fixed) ---

// --- Global Constants ---
const LOGIN_STATE_KEY = 'adminLoggedIn';
const DASHBOARD_URL = 'dashboard.html';
const LOGIN_URL = 'login.html';

// --- Login Page Logic (unchanged) ---
function login() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    // HARDCODED CREDENTIALS (use your real ones)
    const correctUsername = "shivam";
    const correctPassword = "shivam@12345";

    if (usernameInput === correctUsername && passwordInput === correctPassword) {
        sessionStorage.setItem(LOGIN_STATE_KEY, 'true');
        window.location.href = DASHBOARD_URL;
    } else {
        alert('Login Failed! Invalid username or password.');
    }
}

function checkLoginStatus() {
    if (window.location.pathname.includes(DASHBOARD_URL) && sessionStorage.getItem(LOGIN_STATE_KEY) !== 'true') {
        alert('Access Denied. Please log in.');
        window.location.href = LOGIN_URL;
    }
}

function logout() {
    sessionStorage.removeItem(LOGIN_STATE_KEY);
    window.location.href = LOGIN_URL;
}

// --- small utility to show errors ---
function showError(msg) {
    console.log('showError:', msg);
    const el = document.getElementById('errorMessage') || document.getElementById('messageBox');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent = msg || '';
}

// --- Dashboard Page Logic ---
let currentEmployeeData = null;
let columnLabels = {}; 

function initDashboard() {
    if (window.location.pathname.includes(DASHBOARD_URL)) {
        checkLoginStatus(); 
        // safe attach (only if exists)
        const sbtn = document.getElementById('searchButton');
        if (sbtn) sbtn.addEventListener('click', searchEmployee);
        const downloadBtn = document.getElementById('downloadPdfButton');
        if (downloadBtn) downloadBtn.addEventListener('click', generatePDF);
        const logoutBtn = document.getElementById('logoutButton');
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // initial UI hide
        const res = document.getElementById('resultCard');
        if (res) { res.classList.add('hidden'); res.style.display = 'none'; }
        showError('');
        console.log('Dashboard initialized');
    }
}

/**
 * Robust fetch for GViz JSON wrapper.
 */
async function fetchGviz(sheetId, sheetName) {
    const trimmedSheetName = sheetName.trim();
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(trimmedSheetName)}`;
    showError('');
    console.log('Fetching GViz URL:', url);

    try {
        const response = await fetch(url, { method: 'GET', mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const text = await response.text();

        // google returns something like: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
        // Make regex a bit more tolerant:
        const regex = /google\.visualization\.Query\.setResponse\(([\s\S]*?)\);?/;
        const match = text.match(regex);
        let payload = null;
        if (match && match[1]) {
            payload = JSON.parse(match[1]);
        } else {
            // Sometimes response is plain JSON already
            try {
                payload = JSON.parse(text);
            } catch (e) {
                showError('Invalid GVIZ response format. Is the sheet ID and sheet name correct & sheet shared as "Anyone with link - Viewer"?');
                console.error('GViz parse failed, raw text:', text.slice(0,400));
                return null;
            }
        }

        if (!payload || !payload.table) {
            showError('GViz returned no table data. Check sheet name and sharing.');
            console.error('Payload:', payload);
            return null;
        }

        if (payload.status === 'error') {
            showError(`Sheet Data Error: ${payload.errors?.[0]?.message || 'Unknown error'}`);
            return null;
        }

        return payload.table;
    } catch (error) {
        console.error('Fetch GVIZ error:', error);
        showError('Network Error or Sheet not Public/Readable. Check sheet sharing (Anyone with link → Viewer).');
        return null;
    }
}

/**
 * Parses the GVIZ table data and finds the row where column A (index 0) equals given empId.
 */
function matchRowByEmpId(empId, tableData) {
    if (!tableData || !tableData.rows || !tableData.cols) return null;

    const targetEmpId = String(empId).toUpperCase().trim().replace(/\s/g, '');
    let rowMatch = null;

    // Build columnLabels: index -> header (or fallback letter)
    columnLabels = {};
    tableData.cols.forEach((col, index) => {
        const colLetter = String.fromCharCode(65 + index);
        columnLabels[index] = (col && col.label) ? col.label : colLetter;
    });
    console.log('columnLabels:', columnLabels);

    for (const row of tableData.rows) {
        const empCell = row.c && row.c[0];
        let currentEmpId = empCell?.f ?? empCell?.v ?? null;
        if (currentEmpId === null || currentEmpId === undefined) continue;
        currentEmpId = String(currentEmpId).toUpperCase().trim().replace(/\s/g, '');
        if (currentEmpId === targetEmpId) {
            rowMatch = row;
            break;
        }
    }

    if (!rowMatch) return null;

    // Convert row to key:value where key = columnLabels[index]
    const rowData = {};
    rowMatch.c.forEach((cell, index) => {
        let value = cell?.f ?? cell?.v ?? 'N/A';
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) value = 'N/A';
        if (typeof value === 'number') {
            value = value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }
        rowData[columnLabels[index]] = value;
    });

    return rowData;
}

async function searchEmployee() {
    const sheetIdEl = document.getElementById('sheetId');
    const sheetNameEl = document.getElementById('sheetName');
    const empIdEl = document.getElementById('employeeId');

    if (!sheetIdEl || !sheetNameEl || !empIdEl) {
        showError('Missing input fields in HTML. Check element IDs (sheetId, sheetName, employeeId).');
        return;
    }

    const sheetId = sheetIdEl.value.trim();
    const sheetName = sheetNameEl.value.trim();
    const employeeId = empIdEl.value.trim();

    // reset UI
    const resultCard = document.getElementById('resultCard');
    if (resultCard) { resultCard.classList.add('hidden'); resultCard.style.display = 'none'; }
    currentEmployeeData = null;
    showError('');

    if (!employeeId) { showError('Please enter an Employee ID.'); return; }
    if (!sheetName) { showError('Please enter the Sheet Name (Month).'); return; }
    if (!sheetId) { showError('Please provide the Google Sheet ID.'); return; }

    const tableData = await fetchGviz(sheetId, sheetName);
    if (!tableData) return;

    const employeeData = matchRowByEmpId(employeeId, tableData);
    if (!employeeData) {
        showError(`Employee ID '${employeeId}' not found in Column A of sheet '${sheetName}'.`);
        return;
    }

    currentEmployeeData = employeeData;
    displayResults(employeeData, sheetName);
}

/**
 * Display full row for verification and show the result card.
 */
function displayResults(data, month) {
    const detailsDiv = document.getElementById('salaryDetails');
    const resultCard = document.getElementById('resultCard');
    if (!detailsDiv || !resultCard) { showError('Result container missing'); return; }

    let html = `<h3 style="text-align:center;margin-bottom:10px;">Full Row Data (for verification)</h3>`;
    html += `<div style="font-size:13px;color:#444">Found columns: ${Object.values(columnLabels).join(', ')}</div><hr>`;

    // show each column in order
    for (let i = 0; i < Object.keys(columnLabels).length; i++) {
        const header = columnLabels[i] || String.fromCharCode(65 + i);
        const value = data[header] ?? 'N/A';
        const colLetter = String.fromCharCode(65 + i);
        html += `<div style="padding:6px 0;"><strong>${colLetter} - ${header}:</strong> ${value}</div>`;
    }

    html += `<div style="margin-top:12px;text-align:center;color:#2b6cb0">(Click Download Salary Slip to export PDF)</div>`;

    detailsDiv.innerHTML = html;
    resultCard.classList.remove('hidden');
    resultCard.style.display = 'block';
    showError('');
}

/**
 * Safe getter/formatter
 */
const safeGet = (data, idxOrKey) => {
    if (!data) return 'N/A';
    // accept either index (number) or header name
    if (typeof idxOrKey === 'number') {
        const header = columnLabels[idxOrKey];
        return (data[header] === undefined || data[header] === null) ? 'N/A' : String(data[header]);
    }
    const val = data[idxOrKey];
    return (val === undefined || val === null) ? 'N/A' : String(val);
};

function fillSlipTemplate(data, month) {
    // Use expected index mapping (A..H)
    // A: Emp ID (0), B: Name (1), C: Bank Account (2), D: Rate/Day (3)
    // E: Days in Month (4), F: Present(5), G: Absent(6), H: Net Pay(7)
    document.getElementById('slip-month').textContent = month || '';

    document.getElementById('slip-empid').textContent = safeGet(data, 0);
    document.getElementById('slip-name').textContent = safeGet(data, 1);
    document.getElementById('slip-bank').textContent = safeGet(data, 2);

    document.getElementById('slip-rate').textContent = safeGet(data, 3);
    document.getElementById('slip-present').textContent = safeGet(data, 5);
    document.getElementById('slip-absent').textContent = safeGet(data, 6);
    document.getElementById('slip-gross-pay').textContent = safeGet(data, 7); // if gross in H or adjust

    // Deductions (if present in different columns change indices accordingly)
    document.getElementById('slip-pf-deduction').textContent = safeGet(data, 'PF on Basic (12.%)') || '0';
    document.getElementById('slip-esi-deduction').textContent = safeGet(data, 'ESI On Gross (0.75%)') || '0';

    document.getElementById('slip-netpay').textContent = safeGet(data, 7);
}

function generatePDF() {
    if (!currentEmployeeData) {
        showError('No employee data available to generate a slip.');
        return;
    }
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        showError('PDF libraries not loaded (html2canvas or jspdf).');
        console.error('PDF libs missing:', window.html2canvas, window.jspdf);
        return;
    }

    const month = document.getElementById('sheetName').value || 'Month';
    fillSlipTemplate(currentEmployeeData, month);

    const slipElement = document.getElementById('slip');
    if (!slipElement) { showError('Slip template not found'); return; }
    slipElement.classList.remove('hidden');
    slipElement.style.display = 'block';

    setTimeout(() => {
        html2canvas(slipElement, { scale: 2 }).then(canvas => {
            try {
                const { jsPDF } = window.jspdf || window;
                const pdf = new jsPDF('p', 'mm', 'a4');
                const imgData = canvas.toDataURL('image/png');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const imgHeight = canvas.height * pdfWidth / canvas.width;
                pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);

                const empIdForFilename = currentEmployeeData[columnLabels[0]] || 'UNKNOWN';
                const filename = `SalarySlip_${String(empIdForFilename).replace(/\s/g,'_')}_${month.replace(/\s/g,'_')}.pdf`;
                pdf.save(filename);
            } catch (err) {
                console.error('PDF save error:', err);
                showError('Failed to save PDF. Check console.');
            } finally {
                slipElement.classList.add('hidden');
                slipElement.style.display = 'none';
            }
        }).catch(err => {
            console.error('html2canvas error:', err);
            showError('Failed to render slip to image. Check console.');
            slipElement.classList.add('hidden');
            slipElement.style.display = 'none';
        });
    }, 60);
}

// initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});
