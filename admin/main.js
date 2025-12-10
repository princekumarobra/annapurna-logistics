// --- Global Constants ---
const LOGIN_STATE_KEY = 'adminLoggedIn';
const DASHBOARD_URL = 'dashboard.html';
const LOGIN_URL = 'login.html';

// --- Login Page Logic ---

/**
 * Handles the admin login process.
 * Checks hardcoded credentials and sets sessionStorage on success.
 */
function login() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    // Hardcoded credentials: username = "admin", password = "1234"
    const correctUsername = "admin";
    const correctPassword = "1234";

    if (usernameInput === correctUsername && passwordInput === correctPassword) {
        // Set login state in sessionStorage
        sessionStorage.setItem(LOGIN_STATE_KEY, 'true');
        // Redirect to dashboard
        window.location.href = DASHBOARD_URL;
    } else {
        // Show failure alert
        alert('Login Failed! Invalid username or password.');
    }
}

/**
 * Checks if the user is logged in.
 * If not, redirects to the login page. Must be called on dashboard load.
 */
function checkLoginStatus() {
    // Check if we are on the dashboard and not logged in
    if (window.location.pathname.includes(DASHBOARD_URL) && sessionStorage.getItem(LOGIN_STATE_KEY) !== 'true') {
        alert('Access Denied. Please log in.');
        window.location.href = LOGIN_URL;
    }
}

/**
 * Clears the login state and redirects to the login page.
 */
function logout() {
    sessionStorage.removeItem(LOGIN_STATE_KEY);
    window.location.href = LOGIN_URL;
}


// --- Dashboard Page Logic ---

// Variable to store the last fetched employee data
let currentEmployeeData = null;

/**
 * Initializes the dashboard: checks login, sets up event listeners.
 */
function initDashboard() {
    // Only run dashboard-specific code if we are on the dashboard page
    if (window.location.pathname.includes(DASHBOARD_URL)) {
        checkLoginStatus(); // Ensure user is logged in

        document.getElementById('searchButton').addEventListener('click', searchEmployee);
        document.getElementById('downloadPdfButton').addEventListener('click', generatePDF);
        document.getElementById('logoutButton').addEventListener('click', logout);
    }
}

/**
 * Fetches data from Google Sheets using the GVIZ URL and safely parses the JSON.
 * @param {string} sheetId - The Google Sheet ID.
 * @param {string} sheetName - The name of the sheet (month).
 * @returns {Promise<object|null>} The parsed GVIZ JSON table data or null on error.
 */
async function fetchGviz(sheetId, sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${sheetName}`;
    showError(''); // Clear previous error

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const text = await response.text();
        
        // GVIZ response is wrapped in google.visualization.Query.setResponse(...)
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
 * Parses the GVIZ table data to find the row matching the Employee ID and extracts columns.
 * @param {string} empId - The Employee ID to search for (Column A).
 * @param {object} tableData - The table object from the GVIZ JSON.
 * @returns {object|null} An object with extracted employee details or null if not found.
 */
function matchRowByEmpId(empId, tableData) {
    if (!tableData || !tableData.rows) return null;

    const targetEmpId = empId.toUpperCase().trim();
    let rowMatch = null;

    // Define column indices based on requirement: A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
    const COLUMN_INDEX = {
        'Emp ID': 0, 
        'Name': 1, 
        'Bank Account': 2, 
        'Rate Per Day': 3, 
        'Days in Month': 4,
        'Present Days': 5, 
        'Absent Days': 6, 
        'Net Pay': 7
    };
    
    // Find the row where Column A (index 0) matches Emp ID
    for (const row of tableData.rows) {
        // Safely get and normalize the Emp ID from the first column (index 0)
        const currentEmpId = row.c[COLUMN_INDEX['Emp ID']]?.v?.toString().toUpperCase().trim();
        
        if (currentEmpId === targetEmpId) {
            rowMatch = row;
            break;
        }
    }

    if (!rowMatch) return null;

    // Helper to safely get the cell value
    const getCellValue = (colName) => rowMatch.c[COLUMN_INDEX[colName]]?.v ?? 'N/A';
    
    // Helper to format currency (INR) and numbers
    const formatCurrency = (value) => {
        const num = parseFloat(value);
        return isNaN(num) ? 'N/A' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
    };
    const formatNumber = (value) => {
        const num = parseFloat(value);
        return isNaN(num) ? 'N/A' : num.toLocaleString('en-IN');
    };


    return {
        empId: getCellValue('Emp ID'),
        name: getCellValue('Name'),
        bankAccount: getCellValue('Bank Account'),
        ratePerDay: formatCurrency(getCellValue('Rate Per Day')),
        presentDays: formatNumber(getCellValue('Present Days')),
        absentDays: formatNumber(getCellValue('Absent Days')),
        netPay: formatCurrency(getCellValue('Net Pay')),
        netPayRaw: getCellValue('Net Pay') 
    };
}

/**
 * Handles the "Search Employee" button click, fetches data, and displays results.
 */
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

    const tableData = await fetchGviz(sheetId, sheetName);

    if (tableData) {
        const employeeData = matchRowByEmpId(employeeId, tableData);
        
        if (employeeData) {
            currentEmployeeData = employeeData;
            displayResults(employeeData, sheetName);
        } else {
            showError(`Employee ID '${employeeId}' not found in the sheet '${sheetName}'.`);
        }
    }
}

/**
 * Displays the fetched employee data on the dashboard UI card.
 * @param {object} data - The extracted employee data.
 * @param {string} month - The month name.
 */
function displayResults(data, month) {
    const detailsDiv = document.getElementById('salaryDetails');
    const resultCard = document.getElementById('resultCard');

    detailsDiv.innerHTML = `
        <div class="detail-row"><strong>Emp ID:</strong> <span>${data.empId}</span></div>
        <div class="detail-row"><strong>Name:</strong> <span>${data.name}</span></div>
        <div class="detail-row"><strong>Bank A/C:</strong> <span>${data.bankAccount}</span></div>
        <div class="detail-row"><strong>Month:</strong> <span>${month}</span></div>
        <div class="detail-row"><strong>Rate Per Day:</strong> <span>${data.ratePerDay}</span></div>
        <div class="detail-row"><strong>Present Days:</strong> <span>${data.presentDays}</span></div>
        <div class="detail-row"><strong>Absent Days:</strong> <span>${data.absentDays}</span></div>
        <hr>
        <div class="detail-row highlight"><strong>NET PAY:</strong> <span>${data.netPay}</span></div>
    `;
    
    resultCard.classList.remove('hidden');
    showError(''); // Clear error message
}

/**
 * Updates and displays an error message on the dashboard.
 * @param {string} message - The error message to display.
 */
function showError(message) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = message;
}

/**
 * Fills the hidden salary slip template with current data before PDF generation.
 * @param {object} data - The employee data.
 * @param {string} month - The month name.
 */
function fillSlipTemplate(data, month) {
    document.getElementById('slip-month').textContent = month;
    document.getElementById('slip-empid').textContent = data.empId;
    document.getElementById('slip-name').textContent = data.name;
    document.getElementById('slip-bank').textContent = data.bankAccount;
    // Remove the currency symbol for cleaner display in the template
    document.getElementById('slip-rate').textContent = data.ratePerDay.replace('₹', '').trim();
    document.getElementById('slip-present').textContent = data.presentDays;
    document.getElementById('slip-absent').textContent = data.absentDays;
    document.getElementById('slip-netpay').textContent = data.netPay.replace('₹', '').trim();
}

/**
 * Generates and downloads the PDF salary slip using html2canvas and jsPDF.
 */
function generatePDF() {
    if (!currentEmployeeData) {
        showError('No employee data available to generate a slip.');
        return;
    }

    const month = document.getElementById('sheetName').value;
    fillSlipTemplate(currentEmployeeData, month);
    
    const slipElement = document.getElementById('slip');
    slipElement.classList.remove('hidden'); // Make the slip visible to html2canvas

    // html2canvas takes time to render, use a small delay for consistency
    setTimeout(() => {
        // Use window.jspdf as required by the CDN UMD bundle
        const { jsPDF } = window.jspdf; 

        html2canvas(slipElement, { 
            scale: 2, // Higher scale for better resolution
            logging: false 
        }).then(canvas => {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            
            // Calculate dimensions to fit image to A4 page width
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const imgHeight = canvas.height * pdfWidth / canvas.width;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, imgHeight);
            
            // Filename format: SalarySlip_{EMPID}_{MONTH}.pdf
            const filename = `SalarySlip_${currentEmployeeData.empId}_${month}.pdf`;
            pdf.save(filename);
            
            slipElement.classList.add('hidden'); // Hide the template again
        }).catch(err => {
            console.error("PDF generation error:", err);
            showError("Failed to generate PDF. Check console for details.");
            slipElement.classList.add('hidden');
        });
    }, 50); // Small delay to ensure template is fully rendered
}
