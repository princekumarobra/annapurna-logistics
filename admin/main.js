// admin/main.js  (Full replace with this file)

/* ---------------- Constants ---------------- */
const LOGIN_STATE_KEY = 'adminLoggedIn';
const DASHBOARD_URL = 'dashboard.html';
const LOGIN_URL = 'login.html';

const ADMIN_USER = 'shivam';
const ADMIN_PASS = 'shivam@12345';
// Search for headers in rows 0, 1, 2, 3, and 4 (Sheet rows 1 to 5)
const HEADER_SEARCH_DEPTH = 5; 

/* ---------------- Runtime state ---------------- */
let currentEmployeeData = null; // Stores the found row object { 'Label': 'Value', 'A': 'Value', ... }
let columnLabels = {};          // Stores index -> cleaned label (or fallback text)
let detectedEmpColIndex = 0;    // Index of the auto-detected EmpID column
let dataStartRowIndex = 0;      // The row index where actual data begins (after headers)

/* ---------------- Helpers ---------------- */

/**
 * Gets a DOM element by ID.
 */
const getElement = (id) => document.getElementById(id);

/**
 * Shows an error message in the designated area and clears the preview buttons.
 */
function showError(msg) {
    const el = getElement('errorMessage');
    if (!el) return;
    el.textContent = msg || '';
    getElement('salaryDetails').innerHTML = `<p class="initial-message error-state">${msg}</p>`;
    // Disable buttons on error
    getElement('downloadPdfButton').disabled = true;
    getElement('printSlipButton').disabled = true;
    // Hide the slip template
    const slipEl = getElement('slip');
    if (slipEl) slipEl.style.display = 'none';
}

/**
 * Safely formats a value for display, handling nulls, undefined, and numbers.
 */
function safeText(v) {
    if (v === null || v === undefined) return 'N/A';
    if (typeof v === 'number') {
        if (Number.isFinite(v)) {
            // Format number (Indian locale, up to 2 decimal places)
            return v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }
        return String(v).trim() || 'N/A';
    }
    const s = String(v).trim();
    return s === '' ? 'N/A' : s;
}

/**
 * Cleans a string for case-insensitive, whitespace-agnostic comparison.
 */
function normalizeForCompare(s) {
    if (s === null || s === undefined) return '';
    return String(s).toUpperCase().replace(/[\s\u00A0]+/g, ''); // \u00A0 is non-breaking space
}

/**
 * Extracts the value from a GVIZ cell object, prioritizing the formatted value ('f').
 */
function getCellValueFromGviz(cell) {
    if (!cell) return '';
    // Prioritize formatted value 'f' (e.g., for dates/numbers/currency)
    const raw = (cell.f !== undefined && cell.f !== null) ? cell.f : (cell.v !== undefined ? cell.v : '');
    return String(raw).replace(/\u00A0/g, ' ').replace(/\r?\n|\t/g, ' ').trim();
}

/* ---------------- Login / Session ---------------- */

/**
 * Handles the login attempt.
 */
function login() {
    const usernameInput = (getElement('username') || {}).value || '';
    const passwordInput = (getElement('password') || {}).value || '';
    const loginMessageEl = getElement('loginMessage');

    if (usernameInput === ADMIN_USER && passwordInput === ADMIN_PASS) {
        sessionStorage.setItem(LOGIN_STATE_KEY, 'true');
        if (getElement('username')) getElement('username').value = '';
        if (getElement('password')) getElement('password').value = '';
        window.location.href = DASHBOARD_URL;
    } else {
        if (loginMessageEl) loginMessageEl.textContent = 'Invalid username or password.';
    }
}

/**
 * Handles the logout action.
 */
function logout() {
    sessionStorage.removeItem(LOGIN_STATE_KEY);
    window.location.href = LOGIN_URL;
}

/**
 * Checks the login status and redirects if access is denied.
 */
function checkLoginStatus() {
    if (window.location.pathname.includes(DASHBOARD_URL) && sessionStorage.getItem(LOGIN_STATE_KEY) !== 'true') {
        window.location.href = LOGIN_URL;
    }
}

/* ---------------- Fetch GViz ---------------- */

/**
 * Fetches data from Google Sheets using the GVIZ API.
 */
async function fetchGviz(sheetId, sheetName) {
    showError('');
    if (!sheetId) {
        showError('Missing Sheet ID.');
        return null;
    }
    const trimmedSheet = (sheetName || '').trim();
    // Select all rows to check for headers up to HEADER_SEARCH_DEPTH
    const tq = encodeURIComponent('SELECT *'); 
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(trimmedSheet)}&tq=${tq}`;

    try {
        const res = await fetch(url);
        const text = await res.text();
        
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
        
        if (!jsonMatch || !jsonMatch[1]) {
            showError('Invalid Sheet Response. **Troubleshoot: Ensure the Google Sheet is published to the web (File > Share > Publish to web), and the ID/Name are correct.**');
            return null;
        }

        const data = JSON.parse(jsonMatch[1]);

        if (data.status === 'error') {
            const errMsg = data.errors && data.errors[0] && data.errors[0].message ? data.errors[0].message : 'Unknown Sheet error.';
            showError('Sheet Data Error: ' + errMsg);
            return null;
        }
        
        console.log('GViz Data fetched successfully:', data); 

        return data.table;

    } catch (err) {
        console.error('fetchGviz network error:', err);
        showError('Network error or sheet URL is inaccessible. Check browser console for details.');
        return null;
    }
}

/* ---------------- Column labels handling ---------------- */

/**
 * Checks if a row contains keywords that signal it might be a header row.
 */
function rowContainsHeaderKeywords(row) {
    if (!row || !Array.isArray(row.c)) return 0;
    const keywords = ['id', 'name', 'employee', 'gross', 'net', 'pf', 'esi', 'rate', 'code', 'account', 'bank'];
    let keywordCount = 0;
    
    for (const cell of row.c) {
        const val = getCellValueFromGviz(cell).toLowerCase();
        if (keywords.some(kw => val.includes(kw))) {
            keywordCount++;
        }
    }
    return keywordCount;
}

/**
 * Heuristically determines if a row is a good candidate for headers.
 */
function looksLikeHeaderRow(row) {
    if (!row || !Array.isArray(row.c)) return false;
    let textCellCount = 0;
    let totalNonNumericCells = 0;
    
    for (const cell of row.c) {
        const val = getCellValueFromGviz(cell);
        if (val) {
            // Check if the raw GVIZ value is numeric/date
            if (cell.v !== undefined && cell.v !== null && typeof cell.v === 'number' && !isNaN(cell.v)) {
                continue; // Skip counting numeric/date cells as header text
            }
            
            totalNonNumericCells++;

            // Check if the formatted/string value contains significant text
            const letters = val.replace(/[^A-Za-z]/g, '');
            if (letters.length >= 3 || letters.length >= Math.floor(val.length / 2)) {
                textCellCount++;
            }
        }
    }
    // Must contain some keywords and be predominantly text (not numbers/dates)
    return rowContainsHeaderKeywords(row) > 0 && (totalNonNumericCells > 1 && (textCellCount / totalNonNumericCells) >= 0.5);
}

/**
 * Builds the `columnLabels` object using GVIZ metadata or searching the first few rows.
 * Determines `dataStartRowIndex`.
 * Mutates `tableData.rows` to remove header rows.
 */
function buildColumnLabels(tableData) {
    columnLabels = {};
    dataStartRowIndex = 0;
    if (!tableData) return;
    const gvizCols = tableData.cols || [];
    const gvizRows = tableData.rows || [];
    let bestHeaderRowIndex = -1;
    let highestKeywordCount = 0;

    // --- 1. Search up to HEADER_SEARCH_DEPTH (5 rows) for the best header row ---
    for (let i = 0; i < Math.min(HEADER_SEARCH_DEPTH, gvizRows.length); i++) {
        const row = gvizRows[i];
        const keywordCount = rowContainsHeaderKeywords(row);
        
        // If it looks like a header AND has more keywords than the previous best, select it
        if (looksLikeHeaderRow(row) && keywordCount > highestKeywordCount) {
            highestKeywordCount = keywordCount;
            bestHeaderRowIndex = i;
        }
    }
    
    // --- 2. If no clear header found, try GVIZ metadata (original Column A, B...) ---
    if (bestHeaderRowIndex === -1) {
        let usingMetadataLabels = false;
        if (gvizCols.length > 0) {
            gvizCols.forEach((col, i) => {
                const raw = (col && col.label) ? getCellValueFromGviz({f: col.label}) : '';
                const letter = String.fromCharCode(65 + i);
                if (raw && raw.toLowerCase() !== letter.toLowerCase()) {
                    columnLabels[i] = raw;
                    usingMetadataLabels = true;
                }
            });
        }
        if (!usingMetadataLabels) bestHeaderRowIndex = -1; // Keep fallback to generic if metadata is empty/bad
    } 
    
    // --- 3. If a best header row was found, use it and set dataStartRowIndex ---
    if (bestHeaderRowIndex !== -1) {
        const headerRow = gvizRows[bestHeaderRowIndex];
        headerRow.c.forEach((cell, i) => {
            const raw = getCellValueFromGviz(cell);
            if (raw) columnLabels[i] = raw;
        });
        // Remove header row(s) and previous rows from data
        tableData.rows = gvizRows.slice(bestHeaderRowIndex + 1);
        dataStartRowIndex = bestHeaderRowIndex + 1;
    } else {
        // If no header row was selected, use Column A, B, C... labels
        const maxCols = gvizCols.length || gvizRows[0]?.c?.length || 0;
        for (let i = 0; i < maxCols; i++) {
             if (!columnLabels[i]) {
                const letter = String.fromCharCode(65 + i);
                columnLabels[i] = `Column ${letter}`;
            }
        }
        dataStartRowIndex = 0; // Data starts from the first row fetched
    }
    
    // 4. Final fallback: Ensure all columns have a label
    const maxCols = Math.max(gvizCols.length, tableData.rows[0]?.c?.length || 0);
    for (let i = 0; i < maxCols; i++) {
        if (!columnLabels[i]) {
            const letter = String.fromCharCode(65 + i);
            columnLabels[i] = `Column ${letter}`;
        }
    }
    
    console.log(`Data rows start from Sheet Row ${dataStartRowIndex + 1}.`);
}

/**
 * Detects the Employee ID column index using keywords. Fallback is index 0 (Column A).
 */
function detectEmpIdColumn(tableData) {
    detectedEmpColIndex = 0;
    if (!tableData) return detectedEmpColIndex;
    const keywords = ['emp', 'id', 'employee', 'eid', 'e id', 'code'];
    
    for (let i = 0; i < Object.keys(columnLabels).length; i++) {
        const lab = String(columnLabels[i] || '').toLowerCase();
        for (const kw of keywords) {
            if (lab.includes(kw)) {
                detectedEmpColIndex = i;
                return detectedEmpColIndex;
            }
        }
    }
    
    detectedEmpColIndex = 0; // FALLBACK TO COLUMN A
    return detectedEmpColIndex;
}

/**
 * Converts a GVIZ row into a clean object keyed by both the generated label and the column letter.
 */
function rowToObject(row) {
    const obj = {};
    if (!row || !Array.isArray(row.c)) return obj;
    row.c.forEach((cell, idx) => {
        const label = columnLabels[idx] || `Column ${String.fromCharCode(65 + idx)}`;
        const letter = String.fromCharCode(65 + idx);
        
        let value = getCellValueFromGviz(cell);
        if (value === '') value = 'N/A';

        // Store by label (readable) and letter (fallback)
        obj[label] = value;
        obj[letter] = value;
    });
    return obj;
}

/* ---------------- Search logic ---------------- */

/**
 * Searches for an employee ID in the data table.
 */
function matchRowByEmpId(empId, tableData) {
    if (!empId || !tableData || !Array.isArray(tableData.rows)) return null;
    const target = normalizeForCompare(empId);
    const empColIndex = detectedEmpColIndex;

    // 1. Primary (Detected/Fallback to A) column search
    for (const row of tableData.rows) {
        if (!row.c) continue;
        const cell = row.c[empColIndex];
        const raw = getCellValueFromGviz(cell);
        const val = normalizeForCompare(raw);
        if (val && val === target) {
            console.log(`Found ID in primary column: ${columnLabels[empColIndex]}`);
            return rowToObject(row);
        }
    }

    // 2. Fallback: search every cell in each row
    for (const row of tableData.rows) {
        if (!row.c) continue;
        for (let i = 0; i < row.c.length; i++) {
            const cell = row.c[i];
            const raw = getCellValueFromGviz(cell);
            const val = normalizeForCompare(raw);
            if (val && val === target) {
                console.log(`Found ID in fallback (Column ${String.fromCharCode(65 + i)})`);
                return rowToObject(row);
            }
        }
    }

    return null;
}

/* ---------------- Display results (readable labels) ---------------- */

/**
 * Displays the search results in the preview card.
 */
function displayResults(data) {
    const detailsDiv = getElement('salaryDetails');
    const pdfBtn = getElement('downloadPdfButton');
    const printBtn = getElement('printSlipButton');
    if (!detailsDiv || !pdfBtn || !printBtn) return;

    detailsDiv.innerHTML = '';
    
    // Order the display keys by column index
    const keysOrdered = Object.keys(columnLabels).map(k => parseInt(k)).sort((a,b) => a - b);

    // Build the table
    let html = '<table><tbody>'; 

    keysOrdered.forEach(idx => {
        const letter = String.fromCharCode(65 + idx);
        const label = columnLabels[idx];
        const leftText = `${label} (${letter})`;

        // Get value: prefer value keyed by label, else use letter key
        const value = (data[label] !== undefined) ? safeText(data[label]) : (data[letter] !== undefined ? safeText(data[letter]) : 'N/A');

        // Highlight the EmpID row
        const isEmpIdRow = (idx === detectedEmpColIndex);
        const rowStyle = isEmpIdRow ? 'style="font-weight:bold; background:#e0f7fa;"' : '';

        html += `<tr ${rowStyle}><td>${leftText}</td><td>${value}</td></tr>`;
    });
    
    html += '</tbody></table>';
    detailsDiv.innerHTML = html;

    // Enable buttons on successful search
    pdfBtn.disabled = false;
    printBtn.disabled = false;
}

/* ---------------- Slip Population ---------------- */

/**
 * Searches the `columnLabels` for a key matching one of the candidates.
 */
const findKeyInLabels = (candidates) => {
    for (const idx in columnLabels) {
        const lab = String(columnLabels[idx]).toLowerCase();
        for (const cand of candidates) {
            if (lab.includes(cand)) return columnLabels[idx];
        }
    }
    return null;
};

/**
 * Populates the hidden salary slip template with the employee data. (UPDATED logic to find labels)
 */
function fillSlipTemplate(data, month) {
    // Helper to get a value using keyword search, falling back to a default label string
    const getValue = (candidates, fallbackLabel) => {
        const key = findKeyInLabels(candidates) || fallbackLabel;
        // Search by the determined key/label. Since columnLabels are based on headers now, this is reliable.
        return safeText(data[key] || 'N/A');
    };

    getElement('slip-month').textContent = (month || 'NA').toUpperCase();
    
    // Core details (using mapped keys or fallback logic)
    // The Preview shows: Emp ID (A), Name (B), Bank Account Details (C) etc. Use these final labels for better reliability.
    getElement('slip-empid').textContent = getValue(['emp', 'id', 'employee', 'eid', 'code'], 'Emp ID (A)');
    getElement('slip-name').textContent = getValue(['name', 'employee name'], 'Name (B)');
    getElement('slip-bank').textContent = getValue(['bank', 'account', 'bank account'], 'Bank Account Details (C)');
    getElement('slip-uan').textContent = getValue(['uan', 'pf uan'], 'UAN Number');

    // Salary/Attendance details
    getElement('slip-rate').textContent = getValue(['rate per day','rate','salary'], 'Rate Per Day');
    getElement('slip-present').textContent = getValue(['present','days present'], 'Present Days');
    getElement('slip-absent').textContent = getValue(['absent','absent days'], 'Absent Days');
    getElement('slip-gross-pay').textContent = getValue(['gross','gross salary','gross pay'], 'Gross Salary');

    // Deductions
    getElement('slip-pf-deduction').textContent = getValue(['pf','provident'], 'PF');
    getElement('slip-esi-deduction').textContent = getValue(['esi'], 'ESI');

    // Net Pay
    getElement('slip-netpay').textContent = getValue(['net','net pay'], 'Net Pay');
}

/* ---------------- PDF / Print functions ---------------- */

/**
 * Generates a PDF from the populated salary slip template.
 */
function generatePDF() {
    if (!currentEmployeeData) {
        showError('No employee data available to generate a slip.');
        return;
    }
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        showError('PDF libraries not loaded. Ensure internet or local libraries are available.');
        return;
    }

    const month = (getElement('sheetName') || {}).value || '';
    fillSlipTemplate(currentEmployeeData, month); // Repopulate just in case
    const slipElement = getElement('slip');
    slipElement.style.display = 'block'; // Ensure it's visible for canvas rendering
    getElement('downloadPdfButton').disabled = true;

    // Use a small timeout to allow for potential reflow/rendering before capture
    setTimeout(() => {
        const { jsPDF } = window.jspdf;
        html2canvas(slipElement, { scale: 2, logging: false }).then(canvas => {
            const pdf = new jsPDF('p','mm','a4');
            const imgData = canvas.toDataURL('image/png');
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const imgHeight = (canvas.height * pdfWidth) / canvas.width; // Maintain aspect ratio

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);

            const filenameId = safeText(currentEmployeeData[columnLabels[detectedEmpColIndex]] || 'UNKNOWN').replace(/\s+/g, '_');
            const filenameMonth = (month || 'slip').replace(/\s+/g, '_');
            pdf.save(`SalarySlip_${filenameId}_${filenameMonth}.pdf`);

        }).catch(err => {
            console.error('PDF generation error:', err);
            showError('Failed to generate PDF. Check console.');
        }).finally(() => {
            // Re-enable button immediately
            getElement('downloadPdfButton').disabled = false; 
            // Hide template again
            slipElement.style.display = 'none'; 
        });
    }, 50);
}

/**
 * Triggers the browser's print function.
 */
function generatePrint() {
    if (!currentEmployeeData) {
        showError('No employee data available to print.');
        return;
    }
    const month = (getElement('sheetName') || {}).value || '';
    fillSlipTemplate(currentEmployeeData, month);
    
    // Set the display to block so the @media print query can target it
    const slipElement = getElement('slip');
    slipElement.style.display = 'block'; 

    // Open print dialog
    window.print();
    
    // Hide the slip element again after print initiation
    setTimeout(() => slipElement.style.display = 'none', 500); 
}

/* ---------------- Main search flow ---------------- */

/**
 * Main handler for the search button click/Enter press.
 */
async function searchEmployee() {
    showError('');
    currentEmployeeData = null;
    
    const sheetId = (getElement('sheetId') || {}).value || '';
    const sheetName = (getElement('sheetName') || {}).value || '';
    const employeeId = (getElement('employeeId') || {}).value || '';
    const searchButton = getElement('searchButton');

    // Disable button to prevent double-click
    if (searchButton) searchButton.disabled = true;

    if (!employeeId || !sheetName || !sheetId) {
        showError('Please fill in Sheet ID, Sheet Name (Month), and Employee ID.');
        if (searchButton) searchButton.disabled = false;
        return;
    }

    const tableData = await fetchGviz(sheetId, sheetName);
    if (!tableData) {
        if (searchButton) searchButton.disabled = false;
        return;
    }

    // Process data structure: 1. Build labels, 2. Detect EmpID column
    buildColumnLabels(tableData);
    detectEmpIdColumn(tableData);

    // --- Check for empty data rows after parsing headers ---
    if (!tableData.rows || tableData.rows.length === 0) {
        showError('Sheet is empty or contains only header rows. No employee data found to search. (Check data starts from Row ' + (dataStartRowIndex + 1) + ').');
        if (searchButton) searchButton.disabled = false;
        return;
    }
    
    // --- Console Logs for Debugging ---
    console.log('Final Column Labels:', columnLabels);
    console.log('Detected EmpID Index (0 = Col A):', detectedEmpColIndex);
    console.log('Rows available for search:', tableData.rows.length);
    // --- End Console Logs ---


    // 3. Search for the employee
    const rowObj = matchRowByEmpId(employeeId, tableData);
    
    if (!rowObj) {
        const empColLetter = String.fromCharCode(65 + detectedEmpColIndex);
        showError(`Employee ID '${employeeId}' not found in sheet '${sheetName}'. The search checked Column ${empColLetter} first, then the entire sheet.`);
        if (searchButton) searchButton.disabled = false;
        return;
    }
    
    // Success: Store data and display
    currentEmployeeData = rowObj;
    displayResults(rowObj);
    
    if (searchButton) searchButton.disabled = false;
}

/* ---------------- Init ---------------- */

/**
 * Initializes event listeners and checks login status based on the current page.
 */
function initDashboard() {
    if (window.location.pathname.includes(DASHBOARD_URL)) {
        checkLoginStatus(); // Enforces login before accessing dashboard

        // Attach event listeners
        const sb = getElement('searchButton');
        const pdfBtn = getElement('downloadPdfButton');
        const printBtn = getElement('printSlipButton');
        const logoutBtn = getElement('logoutButton');

        if (sb) sb.addEventListener('click', searchEmployee);
        if (pdfBtn) pdfBtn.addEventListener('click', generatePDF);
        if (printBtn) printBtn.addEventListener('click', generatePrint);
        if (logoutBtn) logoutBtn.addEventListener('click', logout);

        // Bind Enter key to search on Employee ID field
        const empInput = getElement('employeeId');
        if (empInput) {
            empInput.addEventListener('keydown', function(e){
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    searchEmployee(); 
                }
            });
        }
    }

    if (window.location.pathname.includes(LOGIN_URL)) {
        // Redirect to dashboard if already logged in
        if(sessionStorage.getItem(LOGIN_STATE_KEY) === 'true') {
            window.location.href = DASHBOARD_URL;
            return;
        }
        
        // Bind login form submission
        const loginForm = getElement('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', function(e){
                e.preventDefault();
                login();
            });
        }
    }
}

// Start initialization once the DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    initDashboard();
});
