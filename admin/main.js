// --- Global Constants ---
const LOGIN_STATE_KEY = 'adminLoggedIn';
const DASHBOARD_URL = 'dashboard.html';
const LOGIN_URL = 'login.html';

// --- Login Page Logic ---
function login() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    // HARDCODED CREDENTIALS
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

// --- Dashboard Page Logic ---
let currentEmployeeData = null;
let columnLabels = {}; 

function initDashboard() {
    if (window.location.pathname.includes(DASHBOARD_URL)) {
        checkLoginStatus(); 
        document.getElementById('searchButton').addEventListener('click', searchEmployee);
        document.getElementById('downloadPdfButton').addEventListener('click', generatePDF);
        document.getElementById('logoutButton').addEventListener('click', logout);
    }
}

async function fetchGviz(sheetId, sheetName) {
    const trimmedSheetName = sheetName.trim(); 
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${trimmedSheetName}`;
    showError('');

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const text = await response.text();
        
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);

        if (!jsonMatch || jsonMatch.length < 2) {
            showError('Invalid GVIZ response format. Is the sheet ID and name correct?');
            return null;
        }

        const data = JSON.parse(jsonMatch[1]);
        
        if (data.status === 'error') {
            showError(`Sheet Data Error: ${data.errors[0].message}. Ensure sheet is public or link-shared.`);
            return null;
        }
        return data.table;
    } catch (error) {
        console.error('Fetch GVIZ error:', error);
        showError('Network Error or Sheet not Public/Readable. Check console for details.');
        return null;
    }
}

/**
 * Parses the GVIZ table data. FIX: Always checks Column A (index 0) for Emp ID.
 */
function matchRowByEmpId(empId, tableData) {
    if (!tableData || !tableData.rows || !tableData.cols) return null;

    const targetEmpId = empId.toUpperCase().trim().replace(/\s/g, ''); 
    let rowMatch = null;

    // 1. Get Column Labels (A, B, C, D, ...)
    columnLabels = {};
    tableData.cols.forEach((col, index) => {
        const colLetter = String.fromCharCode(65 + index); 
        columnLabels[index] = col.label || colLetter; 
    });

    // 2. Find the Row matching Emp ID (HARDCODED to index 0 / Column A)
    for (const row of tableData.rows) {
        const empIdCell = row.c[0]; 
        
        let currentEmpId = empIdCell?.f || empIdCell?.v; 
        
        if (currentEmpId !== null && currentEmpId !== undefined) {
            currentEmpId = String(currentEmpId).toUpperCase().trim().replace(/\s/g, '');
        } else {
            currentEmpId = 'N/A';
        }

        if (currentEmpId === targetEmpId) {
            rowMatch = row;
            break;
        }
    }

    if (!rowMatch) return null;

    // 3. Extract ALL column data for the matched row
    const rowData = {};
    rowMatch.c.forEach((cell, index) => {
        let value = cell?.f ?? cell?.v ?? 'N/A';
        
        if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
            value = 'N/A';
        } else if (typeof value === 'number') {
            value = value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        }
        
        rowData[columnLabels[index]] = value;
    });

    return rowData;
}

async function searchEmployee() {
    const sheetId = document.getElementById('sheetId').value;
    const sheetName = document.getElementById('sheetName').value;
    const employeeId = document.getElementById('employeeId').value;
    
    document.getElementById('resultCard').classList.add('hidden');
    currentEmployeeData = null;

    if (!employeeId) {
        showError('Please enter an Employee ID.');
        return;
    }
    
    if (!sheetName) {
        showError('Please enter the Sheet Name (Month).');
        return;
    }

    const tableData = await fetchGviz(sheetId, sheetName);

    if (tableData) {
        const employeeData = matchRowByEmpId(employeeId, tableData);
        
        if (employeeData) {
            currentEmployeeData = employeeData;
            displayResults(employeeData, sheetName, true); // Show full data
        } else {
            showError(`Employee ID '${employeeId}' not found in Column A of the sheet '${sheetName}'. Please check the ID and Sheet Name.`);
        }
    }
}

/**
 * Displays the fetched employee data on the dashboard UI card. (Now shows Full Data)
 */
function displayResults(data, month, showFullData = false) {
    const detailsDiv = document.getElementById('salaryDetails');
    const resultCard = document.getElementById('resultCard');
    
    let html = '';

    // --- DISPLAY FULL ROW DATA (For verification) ---
    html += `<h3 style="text-align:center; margin-bottom:10px;">Full Row Data (For Verification)</h3>`;
    
    const sortedKeys = Object.keys(data).sort((a, b) => {
        const indexA = Object.keys(columnLabels).find(key => columnLabels[key] === a);
        const indexB = Object.keys(columnLabels).find(key => columnLabels[key] === b);
        return parseInt(indexA) - parseInt(indexB);
    });

    sortedKeys.forEach((key, index) => {
        const colLetter = String.fromCharCode(65 + parseInt(Object.keys(columnLabels).find(k => columnLabels[k] === key)));
        const value = data[key];
        
        const isNetPay = colLetter === 'L'; 
        const isGross = colLetter === 'H';
        const rowClass = isNetPay ? 'highlight' : (isGross ? 'highlight-sub' : '');
        
        html += `
            <div class="detail-row ${rowClass}">
                <strong>${colLetter} - ${key}:</strong> 
                <span>${value}</span>
            </div>
        `;
        if (colLetter === 'C') html += `<hr style="margin: 10px 0;">`; // Separator after Bank Account
    });
    
    html += `<h3 style="text-align:center; margin-top:15px; color:#dc3545;">(To Print PDF, press Download button below.)</h3>`;
    
    detailsDiv.innerHTML = html;
    resultCard.classList.remove('hidden');
    showError('');
}

// Function to safely get and format values for the PDF slip
const safeGet = (data, key) => {
    let value = data[key];
    if (value === undefined || value === null || value === 'N/A') return 'N/A';
    
    if (key.includes('Pay') || key.includes('Salary') || key.includes('Deduction')) {
        const num = parseFloat(String(value).replace(/[^\d\.]/g, ''));
        return isNaN(num) ? String(value).trim() : num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    
    return String(value).trim();
};


/**
 * Fills the hidden salary slip template with current data before PDF generation.
 */
function fillSlipTemplate(data, month) {
    // Column Headers based on the latest sheet data: 
    const empIdKey = columnLabels[0]; 
    const nameKey = columnLabels[1]; 
    const bankAcKey = columnLabels[4]; 
    const rateKey = 'Rate Per Day';
    const presentKey = 'Present Days';
    const absentKey = 'Absent Days';
    const grossKey = 'Gross Salary';
    const pfKey = 'PF on Basic (12.%)';
    const esiKey = 'ESI On Gross (0.75%)';
    const netPayKey = 'Net Pay'; 
    
    document.getElementById('slip-month').textContent = month;
    document.getElementById('slip-empid').textContent = safeGet(data, empIdKey);
    document.getElementById('slip-name').textContent = safeGet(data, nameKey);
    document.getElementById('slip-bank').textContent = safeGet(data, bankAcKey);
    
    // Fill Earnings
    document.getElementById('slip-rate').textContent = safeGet(data, rateKey);
    document.getElementById('slip-present').textContent = safeGet(data, presentKey);
    document.getElementById('slip-absent').textContent = safeGet(data, absentKey);
    document.getElementById('slip-gross-pay').textContent = safeGet(data, grossKey);
    
    // Fill Deductions
    document.getElementById('slip-pf-deduction').textContent = safeGet(data, pfKey);
    document.getElementById('slip-esi-deduction').textContent = safeGet(data, esiKey);
    
    // Fill Net Pay
    document.getElementById('slip-netpay').textContent = safeGet(data, netPayKey);
}


/**
 * Generates and downloads the PDF salary slip.
 */
function generatePDF() {
    if (!currentEmployeeData) {
        showError('No employee data available to generate a slip.');
        return;
    }
    
    if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        showError('PDF libraries are not loaded. Please ensure you are connected to the internet to load CDNs.');
        console.error("html2canvas or jspdf is undefined. Check CDN links in dashboard.html.");
        return;
    }

    const month = document.getElementById('sheetName').value;
    fillSlipTemplate(currentEmployeeData, month);
    
    const slipElement = document.getElementById('slip');
    slipElement.classList.remove('hidden');

    setTimeout(() => {
        const { jsPDF } = window.jspdf; 

        html2canvas(slipElement, { 
            scale: 2, 
            logging: false 
        }).then(canvas => {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const imgHeight = canvas.height * pdfWidth / canvas.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
            
            const empIdForFilename = currentEmployeeData[columnLabels[0]] || 'UNKNOWN'; // Use the data from Column A
            const filename = `SalarySlip_${empIdForFilename.replace(/\s/g, '_')}_${month.replace(/\s/g, '_')}.pdf`;
            pdf.save(filename);
            
            slipElement.classList.add('hidden');
        }).catch(err => {
            console.error("PDF generation error:", err);
            showError("Failed to generate PDF. Check console for details.");
            slipElement.classList.add('hidden');
        });
    }, 50); 
}
