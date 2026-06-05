import { db } from './firebase-config.js';

let currentAdmin = null;

document.addEventListener('DOMContentLoaded', async () => {
    const userJson = localStorage.getItem('currentUser');
    if (!userJson) { window.location.href = 'index.html'; return; }
    
    currentAdmin = JSON.parse(userJson);
    if (currentAdmin.role !== 'admin') { window.location.href = 'index.html'; return; }
    
    await loadEmployees();
    await loadTodayAttendance();
});

window.showSection = function(section) {
    const sections = ['employees', 'attendance', 'reports', 'payroll', 'announcements', 'settings'];
    sections.forEach(s => {
        const el = document.getElementById(s + 'Section');
        if (el) el.style.display = s === section ? 'block' : 'none';
    });
};

async function loadEmployees() {
    const snapshot = await getDocs(collection(db, 'employees'));
    const tableBody = document.getElementById('employeesTable');
    tableBody.innerHTML = '';
    
    snapshot.forEach(doc => {
        const emp = doc.data();
        tableBody.innerHTML += `<tr>
            <td>${emp.fullName}</td>
            <td>${emp.dssn}</td>
            <td>${emp.department}</td>
            <td>${emp.position}</td>
            <td><span class="status-badge status-present">Active</span></td>
            <td><button class="btn-glass-sm" onclick="editEmployee('${doc.id}')">Edit</button> <button class="btn-glass-sm text-danger" onclick="deleteEmployee('${doc.id}')">Delete</button></td>
        </tr>`;
    });
}

async function loadTodayAttendance() {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await getDocs(collection(db, 'attendance'));
    const tableBody = document.getElementById('attendanceTable');
    tableBody.innerHTML = '';
    
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    const employees = {};
    employeesSnapshot.forEach(doc => { employees[doc.id] = doc.data(); });
    
    const todayRecords = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.date === today) todayRecords.push({ id: doc.id, ...data });
    });
    
    for (const emp of Object.values(employees)) {
        const record = todayRecords.find(r => r.employeeId === emp.id);
        let hours = '-';
        if (record?.checkIn && record?.checkOut) {
            const checkIn = record.checkIn.toDate();
            const checkOut = record.checkOut.toDate();
            hours = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(1);
        }
        tableBody.innerHTML += `<tr>
            <td>${emp.fullName}</td>
            <td>${record?.checkIn?.toDate().toLocaleTimeString() || '-'}</td>
            <td>${record?.checkOut?.toDate().toLocaleTimeString() || '-'}</td>
            <td>${hours}</td>
            <td><span class="status-badge ${record ? 'status-present' : 'status-absent'}">${record ? 'Present' : 'Absent'}</span></td>
        </tr>`;
    }
}

window.showAddEmployeeModal = function() {
    const modal = new bootstrap.Modal(document.getElementById('employeeModal'));
    modal.show();
};

window.addEmployee = async function() {
    const fullName = document.getElementById('empName').value;
    const email = document.getElementById('empEmail').value;
    const dssn = document.getElementById('empDSSN').value.toUpperCase();
    const department = document.getElementById('empDepartment').value;
    const position = document.getElementById('empPosition').value;
    const phone = document.getElementById('empPhone').value;
    const salary = parseFloat(document.getElementById('empSalary').value);
    const role = document.getElementById('empRole').value;
    
    if (!fullName || !email || !dssn) { alert('Please fill required fields'); return; }
    
    await addDoc(collection(db, 'employees'), {
        fullName: fullName,
        email: email,
        dssn: dssn,
        department: department,
        position: position,
        phone: phone,
        salary: salary,
        role: role,
        annualLeave: 20,
        sickLeave: 10,
        status: 'active',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('employeeModal')).hide();
    alert('Employee added successfully');
    await loadEmployees();
};

window.generateReport = async function() {
    const startDate = document.getElementById('reportStart').value;
    const endDate = document.getElementById('reportEnd').value;
    
    if (!startDate || !endDate) { alert('Please select date range'); return; }
    
    const snapshot = await getDocs(collection(db, 'attendance'));
    const reportData = [];
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.date >= startDate && data.date <= endDate) {
            reportData.push(data);
        }
    });
    
    const employeeSummary = {};
    reportData.forEach(record => {
        if (!employeeSummary[record.employeeName]) {
            employeeSummary[record.employeeName] = { name: record.employeeName, present: 0, hours: 0 };
        }
        employeeSummary[record.employeeName].present++;
        if (record.checkIn && record.checkOut) {
            const hours = (record.checkOut.toDate() - record.checkIn.toDate()) / (1000 * 60 * 60);
            employeeSummary[record.employeeName].hours += hours;
        }
    });
    
    const resultsDiv = document.getElementById('reportResults');
    resultsDiv.innerHTML = `
        <div class="table-responsive mt-3">
            <table class="glass-table">
                <thead><tr><th>Employee</th><th>Days Present</th><th>Total Hours</th></tr></thead>
                <tbody>
                    ${Object.values(employeeSummary).map(emp => `<tr><td>${emp.name}</td><td>${emp.present}</td><td>${emp.hours.toFixed(1)} hrs</td></tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
};

window.calculatePayroll = async function() {
    const month = document.getElementById('payrollMonth').value;
    if (!month) { alert('Please select month'); return; }
    
    const [year, monthNum] = month.split('-');
    const startDate = `${year}-${monthNum}-01`;
    const lastDay = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
    const endDate = `${year}-${monthNum}-${lastDay}`;
    
    const attendanceSnapshot = await getDocs(collection(db, 'attendance'));
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    
    const employees = {};
    employeesSnapshot.forEach(doc => { employees[doc.id] = { id: doc.id, ...doc.data() }; });
    
    const payroll = [];
    for (const emp of Object.values(employees)) {
        let totalHours = 0;
        attendanceSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.employeeId === emp.id && data.date >= startDate && data.date <= endDate && data.checkIn && data.checkOut) {
                totalHours += (data.checkOut.toDate() - data.checkIn.toDate()) / (1000 * 60 * 60);
            }
        });
        
        const dailyRate = emp.salary / 22;
        const hourlyRate = dailyRate / 8;
        const amount = totalHours * hourlyRate;
        
        payroll.push({ name: emp.fullName, hours: totalHours.toFixed(1), salary: emp.salary, amount: amount.toFixed(2) });
    }
    
    const resultsDiv = document.getElementById('payrollResults');
    resultsDiv.innerHTML = `
        <div class="table-responsive mt-3">
            <table class="glass-table">
                <thead><tr><th>Employee</th><th>Hours Worked</th><th>Monthly Salary</th><th>Pro-rated Amount</th></tr></thead>
                <tbody>
                    ${payroll.map(p => `<tr><td>${p.name}</td><td>${p.hours}</td><td>$${p.salary}</td><td>$${p.amount}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
};

window.showAnnouncementModal = function() {
    const modal = new bootstrap.Modal(document.getElementById('announcementModal'));
    modal.show();
};

window.postAnnouncement = async function() {
    const title = document.getElementById('announceTitle').value;
    const priority = document.getElementById('announcePriority').value;
    const message = document.getElementById('announceMessage').value;
    
    if (!title || !message) { alert('Please fill all fields'); return; }
    
    await addDoc(collection(db, 'announcements'), {
        title: title,
        priority: priority,
        message: message,
        authorId: currentAdmin.id,
        authorName: currentAdmin.fullName,
        readBy: [],
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('announcementModal')).hide();
    alert('Announcement posted successfully');
};

window.editEmployee = async function(id) {
    // Implementation for editing employee
    alert('Edit functionality coming soon');
};

window.deleteEmployee = async function(id) {
    if (confirm('Are you sure you want to delete this employee?')) {
        await deleteDoc(doc(db, 'employees', id));
        await loadEmployees();
    }
};

window.logout = function() {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
};
