import { db } from './firebase-config.js';

let currentUser = null;
let currentEmployee = null;
let signaturePad = null;
let canvas = null;
let ctx = null;
let calendar = null;

// Chat variables
let currentChatType = 'group';
let currentChatUserId = null;
let chatUnsubscribe = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    
    const userJson = localStorage.getItem('currentUser');
    if (!userJson) {
        showLoginModal();
        return;
    }
    
    try {
        currentEmployee = JSON.parse(userJson);
        
        const userDoc = await getDoc(doc(db, 'employees', currentEmployee.id));
        if (!userDoc.exists()) {
            localStorage.removeItem('currentUser');
            showLoginModal();
            return;
        }
        
        currentEmployee = { id: userDoc.id, ...userDoc.data() };
        
        // FIX: Handle field name with space (role )
        const userRole = currentEmployee['role '] || currentEmployee.role || 'employee';
        
        const isAdmin = userRole === 'admin' || userRole === 'super admin';
        
        console.log('Employee role:', userRole);
        console.log('Is admin?', isAdmin);
        
        // Display user role with nickname if available
        const displayName = currentEmployee.nickname || currentEmployee.fullName;
        document.getElementById('userRole').innerHTML = `<strong>${currentEmployee.position || 'Employee'}</strong><br><small>${displayName}</small>`;
        
        // Show admin menu in sidebar
        const adminMenu = document.getElementById('adminMenu');
        if (adminMenu) {
            adminMenu.style.display = isAdmin ? 'block' : 'none';
        }
        
        // Show the admin button in navbar
        const adminNavBtn = document.getElementById('adminNavBtn');
        if (adminNavBtn) {
            adminNavBtn.style.display = isAdmin ? 'inline-block' : 'none';
        }
        
        // Show edit profile button
        const editProfileBtn = document.getElementById('editProfileBtn');
        if (editProfileBtn) {
            editProfileBtn.style.display = 'inline-block';
        }
        
        await loadDashboardData();
        await loadAttendanceHistory();
        await loadAppointments();
        await loadTasks();
        await loadLeaveRequests();
        await loadExpenses();
        await loadDocuments();
        await loadPerformanceReviews();
        await loadAnnouncements();
        
        initSignaturePad();
        updateAttendanceButton();
        
    } catch (error) {
        console.error('Error loading user:', error);
        localStorage.removeItem('currentUser');
        showLoginModal();
    }
});

function showLoginModal() {
    const modalEl = document.getElementById('loginModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

window.login = async function() {
    const dssn = document.getElementById('loginDSSN').value.trim().toUpperCase();
    const password = document.getElementById('loginPassword').value;
    const messageDiv = document.getElementById('loginMessage');
    
    if (!dssn || !password) {
        messageDiv.textContent = 'Please enter both DSSN and Password';
        messageDiv.classList.remove('d-none');
        return;
    }
    
    messageDiv.classList.add('d-none');
    
    try {
        const q = query(collection(db, 'employees'), where('dssn', '==', dssn));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            messageDiv.textContent = 'Invalid DSSN. Please contact HR.';
            messageDiv.classList.remove('d-none');
            return;
        }
        
        let employee = null;
        snapshot.forEach(doc => {
            employee = { id: doc.id, ...doc.data() };
        });
        
        if (!employee.password) {
            currentEmployee = employee;
            document.getElementById('welcomeName').textContent = `Welcome, ${employee.fullName}!`;
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            const setupModal = new bootstrap.Modal(document.getElementById('setupPasswordModal'));
            setupModal.show();
            return;
        }
        
        if (employee.password !== password) {
            messageDiv.textContent = 'Invalid password. Please try again.';
            messageDiv.classList.remove('d-none');
            return;
        }
        
        currentEmployee = employee;
        localStorage.setItem('currentUser', JSON.stringify(currentEmployee));
        bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
        window.location.reload();
        
    } catch (error) {
        console.error('Login error:', error);
        messageDiv.textContent = 'Login failed. Please try again.';
        messageDiv.classList.remove('d-none');
    }
};

window.setupPassword = async function() {
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const messageDiv = document.getElementById('setupMessage');
    
    if (!newPassword || newPassword.length < 6) {
        messageDiv.textContent = 'Password must be at least 6 characters';
        messageDiv.classList.remove('d-none');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        messageDiv.textContent = 'Passwords do not match';
        messageDiv.classList.remove('d-none');
        return;
    }
    
    messageDiv.classList.add('d-none');
    
    try {
        await updateDoc(doc(db, 'employees', currentEmployee.id), {
            password: newPassword,
            passwordSetup: true,
            setupDate: Timestamp.now()
        });
        
        currentEmployee.password = newPassword;
        localStorage.setItem('currentUser', JSON.stringify(currentEmployee));
        
        bootstrap.Modal.getInstance(document.getElementById('setupPasswordModal')).hide();
        window.location.reload();
        
    } catch (error) {
        console.error('Password setup error:', error);
        messageDiv.textContent = 'Failed to set password. Please try again.';
        messageDiv.classList.remove('d-none');
    }
};

function updateDateTime() {
    const now = new Date();
    const dateTimeElem = document.getElementById('currentDateTime');
    if (dateTimeElem) dateTimeElem.textContent = now.toLocaleString();
    const dateElem = document.getElementById('attendanceDate');
    if (dateElem) dateElem.textContent = now.toLocaleDateString();
}

function initSignaturePad() {
    canvas = document.getElementById('signatureCanvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    let drawing = false;
    canvas.addEventListener('mousedown', () => drawing = true);
    canvas.addEventListener('mouseup', () => drawing = false);
    canvas.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, 2, 2);
    });
    
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); drawing = true; });
    canvas.addEventListener('touchend', () => drawing = false);
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!drawing) return;
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        ctx.fillStyle = '#000';
        ctx.fillRect(x, y, 2, 2);
    });
}

window.clearSignature = function() {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
};

window.getLocation = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                window.currentLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                const locationDisplay = document.getElementById('locationDisplay');
                if (locationDisplay) {
                    locationDisplay.value = `Lat: ${window.currentLocation.lat.toFixed(6)}, Lng: ${window.currentLocation.lng.toFixed(6)}`;
                }
                Swal.fire({ title: 'Success', text: 'Location captured successfully', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
            },
            (error) => { Swal.fire({ title: 'Error', text: 'Unable to get location: ' + error.message, icon: 'error', background: '#000', confirmButtonColor: '#6c63ff' }); }
        );
    }
};

window.checkIn = async function() {
    if (!window.currentLocation) { Swal.fire({ title: 'Error', text: 'Please capture your location first', icon: 'error', background: '#000' }); return; }
    
    if (!canvas || !ctx) return;
    const imageData = canvas.toDataURL();
    
    try {
        const today = new Date().toISOString().split('T')[0];
        await addDoc(collection(db, 'attendance'), {
            employeeId: currentEmployee.id,
            employeeName: currentEmployee.fullName,
            employeeDSSN: currentEmployee.dssn,
            employeePosition: currentEmployee.position,
            date: today,
            checkIn: Timestamp.now(),
            checkInLocation: window.currentLocation,
            signature: imageData,
            notes: document.getElementById('attendanceNotes')?.value || '',
            status: 'present',
            createdAt: Timestamp.now()
        });
        
        Swal.fire({ title: 'Success', text: 'Checked in successfully!', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
        
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');
        const statusDiv = document.getElementById('attendanceStatus');
        
        if (checkInBtn) checkInBtn.style.display = 'none';
        if (checkOutBtn) checkOutBtn.style.display = 'block';
        if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success">✅ Checked In</div>';
        
        await loadAttendanceHistory();
        await loadDashboardData();
    } catch (error) {
        Swal.fire({ title: 'Error', text: 'Check-in failed: ' + error.message, icon: 'error', background: '#000' });
    }
};

window.checkOut = async function() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const q = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), where('date', '==', today));
        const snapshot = await getDocs(q);
        
        let attendanceId = null;
        snapshot.forEach(doc => { attendanceId = doc.id; });
        
        if (attendanceId) {
            await updateDoc(doc(db, 'attendance', attendanceId), {
                checkOut: Timestamp.now(),
                checkOutLocation: window.currentLocation || null,
                updatedAt: Timestamp.now()
            });
            
            Swal.fire({ title: 'Success', text: 'Checked out successfully!', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
            
            const checkOutBtn = document.getElementById('checkOutBtn');
            const statusDiv = document.getElementById('attendanceStatus');
            
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-info">✅ Completed Today</div>';
            
            await loadAttendanceHistory();
            await loadDashboardData();
        }
    } catch (error) {
        Swal.fire({ title: 'Error', text: 'Check-out failed: ' + error.message, icon: 'error', background: '#000' });
    }
};

async function updateAttendanceButton() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const q = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), where('date', '==', today));
        const snapshot = await getDocs(q);
        
        let hasCheckIn = false, hasCheckOut = false;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.checkIn) hasCheckIn = true;
            if (data.checkOut) hasCheckOut = true;
        });
        
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');
        const statusDiv = document.getElementById('attendanceStatus');
        
        if (!hasCheckIn) {
            if (checkInBtn) checkInBtn.style.display = 'block';
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-warning">⏰ Not Checked In Yet</div>';
        } else if (hasCheckIn && !hasCheckOut) {
            if (checkInBtn) checkInBtn.style.display = 'none';
            if (checkOutBtn) checkOutBtn.style.display = 'block';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success">✅ Checked In</div>';
        } else {
            if (checkInBtn) checkInBtn.style.display = 'none';
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-info">✅ Completed Today</div>';
        }
    } catch (error) {
        console.error('Error checking attendance status:', error);
    }
}

// ========== DASHBOARD WITH CLICKABLE CARDS ==========
async function loadDashboardData() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const attendanceQ = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), where('date', '==', today));
        const attendanceSnapshot = await getDocs(attendanceQ);
        
        let hours = 0;
        attendanceSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.checkIn && data.checkOut) {
                const checkIn = data.checkIn.toDate();
                const checkOut = data.checkOut.toDate();
                hours = (checkOut - checkIn) / (1000 * 60 * 60);
            }
        });
        const todayHoursElem = document.getElementById('todayHours');
        if (todayHoursElem) todayHoursElem.textContent = hours.toFixed(1);
        
        const tasksQ = query(collection(db, 'tasks'));
        const tasksSnapshot = await getDocs(tasksQ);
        const pendingCount = tasksSnapshot.docs.filter(d => d.data().status === 'pending' || d.data().status === 'in_progress').length;
        const pendingTasksElem = document.getElementById('pendingTasks');
        if (pendingTasksElem) pendingTasksElem.textContent = pendingCount;
        
        const appointmentsQ = query(collection(db, 'appointments'));
        const appointmentsSnapshot = await getDocs(appointmentsQ);
        const todayAppointmentsElem = document.getElementById('todayAppointments');
        if (todayAppointmentsElem) todayAppointmentsElem.textContent = appointmentsSnapshot.size;
        
        const announcementsQ = query(collection(db, 'announcements'));
        const announcementsSnapshot = await getDocs(announcementsQ);
        const unreadCount = announcementsSnapshot.docs.filter(d => !(d.data().readBy || []).includes(currentEmployee.id)).length;
        const unreadAnnouncementsElem = document.getElementById('unreadAnnouncements');
        if (unreadAnnouncementsElem) unreadAnnouncementsElem.textContent = unreadCount;
        
        // Recent activities - clickable
        const activitiesQ = query(collection(db, 'attendance'), orderBy('createdAt', 'desc'), limit(10));
        const activitiesSnapshot = await getDocs(activitiesQ);
        const activitiesHtml = [];
        activitiesSnapshot.forEach(doc => {
            const data = doc.data();
            activitiesHtml.push(`
                <div class="activity-item glass-card-hover" onclick="showAttendanceDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-clock" style="color: #a8b5ff;"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName || 'Employee'}</strong> - ${data.status || 'Checked in'}
                        <small class="d-block text-muted">${data.date} at ${data.checkIn?.toDate().toLocaleTimeString() || ''}</small>
                    </div>
                    <i class="fas fa-chevron-right" style="color: #a8b5ff;"></i>
                </div>
            `);
        });
        const recentActivitiesElem = document.getElementById('recentActivities');
        if (recentActivitiesElem) recentActivitiesElem.innerHTML = activitiesHtml.join('') || '<div class="text-center p-3 text-muted">No recent activities</div>';
        
        // Upcoming appointments - clickable
        const upcomingQ = query(collection(db, 'appointments'), where('startTime', '>=', Timestamp.now()), orderBy('startTime'), limit(10));
        const upcomingSnapshot = await getDocs(upcomingQ);
        const upcomingHtml = [];
        upcomingSnapshot.forEach(doc => {
            const data = doc.data();
            upcomingHtml.push(`
                <div class="schedule-item glass-card-hover" onclick="showAppointmentDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-calendar-alt" style="color: #a8b5ff;"></i>
                    <div class="flex-grow-1">
                        <strong>${data.title}</strong>
                        <small class="d-block text-muted">${data.startTime?.toDate().toLocaleString()} by ${data.organizerName || 'Organizer'}</small>
                    </div>
                    <i class="fas fa-chevron-right" style="color: #a8b5ff;"></i>
                </div>
            `);
        });
        const upcomingAppointmentsElem = document.getElementById('upcomingAppointments');
        if (upcomingAppointmentsElem) upcomingAppointmentsElem.innerHTML = upcomingHtml.join('') || '<div class="text-center p-3 text-muted">No upcoming appointments</div>';
        
        // Recent Tasks - clickable cards
        const recentTasksQ = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(10));
        const recentTasksSnapshot = await getDocs(recentTasksQ);
        const tasksHtml = [];
        recentTasksSnapshot.forEach(doc => {
            const data = doc.data();
            const priorityColor = data.priority === 'High' ? '#f44336' : data.priority === 'Medium' ? '#ff9800' : '#4caf50';
            tasksHtml.push(`
                <div class="task-card-mini glass-card-hover" onclick="showTaskDetail('${doc.id}')" style="cursor: pointer; border-left: 3px solid ${priorityColor};">
                    <i class="fas fa-tasks" style="color: #a8b5ff;"></i>
                    <div class="flex-grow-1">
                        <strong>${data.title}</strong>
                        <small class="d-block text-muted">Assigned to: ${data.assignedByName || 'Unassigned'} | Due: ${data.dueDate?.toDate().toLocaleDateString() || 'No date'}</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right" style="color: #a8b5ff;"></i>
                </div>
            `);
        });
        
        // Recent Leave Requests - clickable cards
        const leaveQ = query(collection(db, 'leave_requests'), orderBy('createdAt', 'desc'), limit(10));
        const leaveSnapshot = await getDocs(leaveQ);
        const leaveHtml = [];
        leaveSnapshot.forEach(doc => {
            const data = doc.data();
            leaveHtml.push(`
                <div class="leave-card-mini glass-card-hover" onclick="showLeaveDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-umbrella-beach" style="color: #a8b5ff;"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName}</strong> - ${data.type}
                        <small class="d-block text-muted">${data.startDate} to ${data.endDate} (${data.totalDays} days)</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right" style="color: #a8b5ff;"></i>
                </div>
            `);
        });
        
        // Recent Expenses - clickable cards
        const expensesQ = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(10));
        const expensesSnapshot = await getDocs(expensesQ);
        const expensesHtml = [];
        expensesSnapshot.forEach(doc => {
            const data = doc.data();
            expensesHtml.push(`
                <div class="expense-card-mini glass-card-hover" onclick="showExpenseDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-receipt" style="color: #a8b5ff;"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName}</strong> - ${data.category}
                        <small class="d-block text-muted">$${data.amount} - ${data.date}</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right" style="color: #a8b5ff;"></i>
                </div>
            `);
        });
        
        // Update the dashboard with new sections
        const dashboardSection = document.getElementById('dashboardSection');
        if (dashboardSection) {
            let additionalRow = dashboardSection.querySelector('.additional-dashboard-row');
            if (!additionalRow) {
                additionalRow = document.createElement('div');
                additionalRow.className = 'row mt-4 additional-dashboard-row';
                dashboardSection.appendChild(additionalRow);
            }
            
            additionalRow.innerHTML = `
                <div class="col-md-4">
                    <div class="glass-card-inner">
                        <div class="card-header-glass"><i class="fas fa-tasks"></i> Recent Tasks <button class="btn-glass-primary btn-sm float-end" onclick="showAddTaskModal()">+ New Task</button></div>
                        <div id="recentTasksList">${tasksHtml.join('') || '<div class="text-center p-3 text-muted">No tasks found</div>'}</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="glass-card-inner">
                        <div class="card-header-glass"><i class="fas fa-umbrella-beach"></i> Recent Leave Requests</div>
                        <div id="recentLeaveList">${leaveHtml.join('') || '<div class="text-center p-3 text-muted">No leave requests</div>'}</div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="glass-card-inner">
                        <div class="card-header-glass"><i class="fas fa-receipt"></i> Recent Expenses</div>
                        <div id="recentExpensesList">${expensesHtml.join('') || '<div class="text-center p-3 text-muted">No expenses submitted</div>'}</div>
                    </div>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// ===== DETAIL VIEW FUNCTIONS =====
window.showTaskDetail = async function(taskId) {
    const taskDoc = await getDoc(doc(db, 'tasks', taskId));
    if (!taskDoc.exists()) return;
    const task = taskDoc.data();
    
    Swal.fire({
        title: task.title,
        html: `
            <div class="text-start">
                <p><strong>Description:</strong><br>${task.description || 'No description'}</p>
                <p><strong>Priority:</strong> <span class="badge bg-${task.priority === 'High' ? 'danger' : task.priority === 'Medium' ? 'warning' : 'info'}">${task.priority || 'Medium'}</span></p>
                <p><strong>Status:</strong> <span class="badge bg-${task.status === 'completed' ? 'success' : 'warning'}">${task.status || 'pending'}</span></p>
                <p><strong>Assigned To:</strong> ${task.assignedByName || 'Unassigned'}</p>
                <p><strong>Due Date:</strong> ${task.dueDate?.toDate().toLocaleDateString() || 'No date'}</p>
                <p><strong>Created By:</strong> ${task.createdByName || 'Unknown'}</p>
                <p><strong>Created At:</strong> ${task.createdAt?.toDate().toLocaleString()}</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.9)',
        showDenyButton: task.status !== 'completed',
        denyButtonText: 'Mark Complete',
        denyButtonColor: '#4caf50'
    }).then((result) => {
        if (result.isDenied) {
            updateTaskStatus(taskId, 'completed');
        }
    });
};

window.showAppointmentDetail = async function(appointmentId) {
    const appointmentDoc = await getDoc(doc(db, 'appointments', appointmentId));
    if (!appointmentDoc.exists()) return;
    const apt = appointmentDoc.data();
    
    Swal.fire({
        title: apt.title,
        html: `
            <div class="text-start">
                <p><strong>Type:</strong> ${apt.type}</p>
                <p><strong>Date & Time:</strong> ${apt.startTime?.toDate().toLocaleString()}</p>
                <p><strong>Duration:</strong> ${apt.duration || 60} minutes</p>
                <p><strong>Location:</strong> ${apt.location || 'Not specified'}</p>
                <p><strong>Description:</strong><br>${apt.description || 'No description'}</p>
                <p><strong>Organized By:</strong> ${apt.organizerName} (${apt.organizerPosition || 'Staff'})</p>
                <p><strong>Status:</strong> <span class="badge bg-${apt.status === 'scheduled' ? 'primary' : 'secondary'}">${apt.status}</span></p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.9)'
    });
};

window.showAnnouncementDetail = async function(announcementId) {
    const announcementDoc = await getDoc(doc(db, 'announcements', announcementId));
    if (!announcementDoc.exists()) return;
    const ann = announcementDoc.data();
    
    Swal.fire({
        title: ann.title,
        html: `
            <div class="text-start">
                <p><strong>Priority:</strong> <span class="badge bg-${ann.priority === 'Urgent' ? 'danger' : ann.priority === 'High' ? 'warning' : 'info'}">${ann.priority || 'Normal'}</span></p>
                <p><strong>Message:</strong><br>${ann.message}</p>
                <p><strong>Posted By:</strong> ${ann.authorName} (${ann.authorPosition || 'Administrator'})</p>
                <p><strong>Posted At:</strong> ${ann.createdAt?.toDate().toLocaleString()}</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.8)'
    });
    
    if (!(ann.readBy || []).includes(currentEmployee.id)) {
        await updateDoc(doc(db, 'announcements', announcementId), {
            readBy: [...(ann.readBy || []), currentEmployee.id]
        });
    }
};

window.showAttendanceDetail = async function(attendanceId) {
    const attendanceDoc = await getDoc(doc(db, 'attendance', attendanceId));
    if (!attendanceDoc.exists()) return;
    const att = attendanceDoc.data();
    
    Swal.fire({
        title: `${att.employeeName}'s Attendance`,
        html: `
            <div class="text-start">
                <p><strong>Date:</strong> ${att.date}</p>
                <p><strong>Check In:</strong> ${att.checkIn?.toDate().toLocaleTimeString() || 'Not checked in'}</p>
                <p><strong>Check Out:</strong> ${att.checkOut?.toDate().toLocaleTimeString() || 'Not checked out'}</p>
                <p><strong>Status:</strong> <span class="badge bg-${att.status === 'present' ? 'success' : 'warning'}">${att.status}</span></p>
                <p><strong>Location:</strong> ${att.checkInLocation ? `Lat: ${att.checkInLocation.lat}, Lng: ${att.checkInLocation.lng}` : 'Not captured'}</p>
                <p><strong>Notes:</strong> ${att.notes || 'No notes'}</p>
                <p><strong>Employee:</strong> ${att.employeeName} (${att.employeePosition || 'Staff'})</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.8)'
    });
};

window.showLeaveDetail = async function(leaveId) {
    const leaveDoc = await getDoc(doc(db, 'leave_requests', leaveId));
    if (!leaveDoc.exists()) return;
    const leave = leaveDoc.data();
    
    Swal.fire({
        title: `${leave.employeeName}'s Leave Request`,
        html: `
            <div class="text-start">
                <p><strong>Type:</strong> ${leave.type}</p>
                <p><strong>Dates:</strong> ${leave.startDate} to ${leave.endDate}</p>
                <p><strong>Total Days:</strong> ${leave.totalDays} days</p>
                <p><strong>Reason:</strong><br>${leave.reason || 'No reason provided'}</p>
                <p><strong>Status:</strong> <span class="badge bg-${leave.status === 'approved' ? 'success' : leave.status === 'rejected' ? 'danger' : 'warning'}">${leave.status}</span></p>
                <p><strong>Requested On:</strong> ${leave.createdAt?.toDate().toLocaleString()}</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.9)'
    });
};

window.showExpenseDetail = async function(expenseId) {
    const expenseDoc = await getDoc(doc(db, 'expenses', expenseId));
    if (!expenseDoc.exists()) return;
    const expense = expenseDoc.data();
    
    Swal.fire({
        title: `${expense.employeeName}'s Expense`,
        html: `
            <div class="text-start">
                <p><strong>Category:</strong> ${expense.category}</p>
                <p><strong>Amount:</strong> $${expense.amount}</p>
                <p><strong>Date:</strong> ${expense.date}</p>
                <p><strong>Description:</strong><br>${expense.description || 'No description'}</p>
                <p><strong>Status:</strong> <span class="badge bg-${expense.status === 'approved' ? 'success' : expense.status === 'rejected' ? 'danger' : 'warning'}">${expense.status}</span></p>
                ${expense.receiptUrl ? `<p><strong>Receipt:</strong> <a href="${expense.receiptUrl}" target="_blank" style="color: #6c63ff;">View Receipt</a></p>` : ''}
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: '#000',
        backdrop: 'rgba(0,0,0,0.9)'
    });
};

// ===== LOAD FUNCTIONS =====
async function loadAttendanceHistory() {
    try {
        const q = query(collection(db, 'attendance'), orderBy('date', 'desc'), limit(30));
        const snapshot = await getDocs(q);
        const tableBody = document.getElementById('attendanceHistoryTable');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            let hours = '-';
            if (data.checkIn && data.checkOut) {
                const checkIn = data.checkIn.toDate();
                const checkOut = data.checkOut.toDate();
                hours = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(1);
            }
            tableBody.innerHTML += `
                <tr onclick="showAttendanceDetail('${doc.id}')" style="cursor: pointer;">
                    <td>${data.employeeName || 'Employee'} <small class="text-muted d-block">${data.employeePosition || ''}</small></td>
                    <td>${data.date}</td>
                    <td>${data.checkIn?.toDate().toLocaleTimeString() || '-'}</td>
                    <td>${data.checkOut?.toDate().toLocaleTimeString() || '-'}</td>
                    <td>${hours}</td>
                    <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Error loading attendance history:', error);
    }
}

async function loadAppointments() {
    try {
        const q = query(collection(db, 'appointments'), orderBy('startTime', 'desc'));
        const snapshot = await getDocs(q);
        const tableBody = document.getElementById('appointmentsTable');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            tableBody.innerHTML += `
                <tr onclick="showAppointmentDetail('${doc.id}')" style="cursor: pointer;">
                    <td>${data.title}</td>
                    <td>${data.startTime?.toDate().toLocaleString()}</td>
                    <td>${data.type}</td>
                    <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                    <td><small>By: ${data.organizerName}</small></td>
                </tr>
            `;
        });
        
        if (calendar) calendar.destroy();
        const calendarEl = document.getElementById('calendar');
        if (calendarEl) {
            calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
                events: snapshot.docs.map(doc => {
                    const data = doc.data();
                    return { title: `${data.title} (${data.organizerName})`, start: data.startTime?.toDate(), extendedProps: { type: data.type, id: doc.id } };
                }),
                eventClick: (info) => showAppointmentDetail(info.event.extendedProps.id),
                themeSystem: 'standard',
                height: 'auto'
            });
            calendar.render();
        }
    } catch (error) {
        console.error('Error loading appointments:', error);
    }
}

async function loadTasks() {
    try {
        const filter = document.getElementById('taskFilter')?.value || 'all';
        let q;
        if (filter === 'all') {
            q = query(collection(db, 'tasks'), orderBy('dueDate'));
        } else {
            q = query(collection(db, 'tasks'), where('status', '==', filter), orderBy('dueDate'));
        }
        const snapshot = await getDocs(q);
        const container = document.getElementById('tasksList');
        if (!container) return;
        container.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const priorityClass = `task-highlight-${data.priority?.toLowerCase() || 'low'}`;
            container.innerHTML += `
                <div class="task-card ${priorityClass}" onclick="showTaskDetail('${doc.id}')" style="cursor: pointer;">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6>${data.title}</h6>
                        <span class="status-badge status-${data.status}">${data.status}</span>
                    </div>
                    <p class="small text-muted mt-2">${data.description || ''}</p>
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <small><i class="far fa-calendar-alt"></i> Due: ${data.dueDate?.toDate().toLocaleDateString() || 'No date'}</small>
                        <small><i class="fas fa-user"></i> Assigned to: ${data.assignedByName || 'Unassigned'}</small>
                    </div>
                </div>
            `;
        });
        
        if (snapshot.size === 0) container.innerHTML = '<div class="text-center p-4">No tasks found</div>';
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

async function loadLeaveRequests() {
    try {
        const q = query(collection(db, 'leave_requests'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('leaveRequestsList');
        if (!container) return;
        container.innerHTML = '';
        
        let pending = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'pending') pending++;
            container.innerHTML += `
                <div class="glass-card-inner p-3 mb-2" onclick="showLeaveDetail('${doc.id}')" style="cursor: pointer;">
                    <div class="d-flex justify-content-between">
                        <span><strong>${data.employeeName}</strong> - ${data.type}</span>
                        <span class="status-badge status-${data.status}">${data.status}</span>
                    </div>
                    <div><small>${data.startDate} to ${data.endDate} (${data.totalDays} days)</small></div>
                    <p class="small mt-1">${data.reason}</p>
                    <small class="text-muted">Requested: ${data.createdAt?.toDate().toLocaleDateString()}</small>
                </div>
            `;
        });
        const pendingRequestsElem = document.getElementById('pendingRequests');
        if (pendingRequestsElem) pendingRequestsElem.textContent = pending;
        
        const annualBalanceElem = document.getElementById('annualBalance');
        const sickBalanceElem = document.getElementById('sickBalance');
        if (annualBalanceElem) annualBalanceElem.textContent = currentEmployee.annualLeave || 20;
        if (sickBalanceElem) sickBalanceElem.textContent = currentEmployee.sickLeave || 10;
    } catch (error) {
        console.error('Error loading leave requests:', error);
    }
}

async function loadExpenses() {
    try {
        const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('expensesList');
        if (!container) return;
        container.innerHTML = '<div class="table-responsive"><table class="glass-table"><thead><tr><th>Employee</th><th>Date</th><th>Category</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table></div>';
        const tbody = container.querySelector('tbody');
        
        snapshot.forEach(doc => {
            const data = doc.data();
            tbody.innerHTML += `
                <tr>
                    <td>${data.employeeName} <small class="text-muted d-block">${data.employeePosition || ''}</small></td>
                    <td>${data.date}</td>
                    <td>${data.category}</td>
                    <td>$${data.amount}</td>
                    <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                    <td><button class="btn-glass-sm" onclick="showExpenseDetail('${doc.id}')">View</button></td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Error loading expenses:', error);
    }
}

async function loadDocuments() {
    try {
        const q = query(collection(db, 'documents'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('documentsList');
        if (!container) return;
        container.innerHTML = `
            <div class="text-end mb-3">
                <button class="btn-glass-primary" onclick="showAddDocumentModal()"><i class="fas fa-plus"></i> Upload Document</button>
            </div>
            <div class="row g-3" id="documentsGrid"></div>
        `;
        const grid = container.querySelector('#documentsGrid');
        grid.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const fileExt = data.fileType || 'file';
            grid.innerHTML += `
                <div class="col-md-4">
                    <div class="glass-card-inner p-3" onclick="window.open('${data.fileUrl}', '_blank')" style="cursor: pointer;">
                        <div class="d-flex align-items-center gap-3">
                            <i class="fas fa-file-${fileExt === 'pdf' ? 'pdf' : 'image'} fa-2x text-${fileExt === 'pdf' ? 'danger' : 'primary'}"></i>
                            <div class="flex-grow-1">
                                <h6>${data.title}</h6>
                                <small class="text-muted">Uploaded by ${data.uploadedByName} (${data.uploadedByPosition})<br>${data.createdAt?.toDate().toLocaleDateString()}</small>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    } catch (error) {
        console.error('Error loading documents:', error);
    }
}

async function loadPerformanceReviews() {
    try {
        const q = query(collection(db, 'performance_reviews'), orderBy('reviewDate', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('performanceReviews');
        if (!container) return;
        container.innerHTML = `
            <div class="text-end mb-3">
                <button class="btn-glass-primary" onclick="showAddReviewModal()"><i class="fas fa-plus"></i> Add Review</button>
            </div>
            <div id="reviewsList"></div>
        `;
        const reviewsList = container.querySelector('#reviewsList');
        reviewsList.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const rating = data.rating || 0;
            const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
            reviewsList.innerHTML += `
                <div class="glass-card-inner p-3 mb-2" onclick="showReviewDetail('${doc.id}')" style="cursor: pointer;">
                    <div class="d-flex justify-content-between">
                        <div>
                            <strong>${data.employeeName}</strong> (${data.employeePosition})
                            <div>${stars}</div>
                        </div>
                        <div class="text-end">
                            <small>Reviewed by ${data.reviewerName} (${data.reviewerPosition})</small><br>
                            <small class="text-muted">${data.reviewDate?.toDate().toLocaleDateString()}</small>
                        </div>
                    </div>
                    <p class="mt-2 small">${data.feedback}</p>
                </div>
            `;
        });
    } catch (error) {
        console.error('Error loading performance reviews:', error);
    }
}

async function loadAnnouncements() {
    try {
        const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(10));
        const snapshot = await getDocs(q);
        const container = document.getElementById('announcementsList');
        if (!container) return;
        container.innerHTML = `
            <div class="text-end mb-3">
                <button class="btn-glass-primary" onclick="showAddAnnouncementModal()"><i class="fas fa-plus"></i> Post Announcement</button>
            </div>
            <div id="announcementsContainer"></div>
        `;
        const announcementsContainer = container.querySelector('#announcementsContainer');
        announcementsContainer.innerHTML = '';
        
        for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();
            const isRead = (data.readBy || []).includes(currentEmployee.id);
            announcementsContainer.innerHTML += `
                <div class="glass-card-inner p-3 mb-2 ${isRead ? '' : 'border-primary'}" onclick="showAnnouncementDetail('${docSnapshot.id}')" style="cursor: pointer;">
                    <div class="d-flex justify-content-between">
                        <div>
                            <h6><i class="fas fa-bullhorn"></i> ${data.title}</h6>
                            <p class="mt-2">${data.message}</p>
                        </div>
                        <div class="text-end">
                            <span class="badge ${data.priority === 'Urgent' ? 'bg-danger' : 'bg-primary'}">${data.priority || 'Normal'}</span><br>
                            <small class="text-muted">Posted by ${data.authorName}<br>${data.createdAt?.toDate().toLocaleString()}</small>
                        </div>
                    </div>
                </div>
            `;
            
            if (!isRead) {
                await updateDoc(docSnapshot.ref, { readBy: [...(data.readBy || []), currentEmployee.id] });
            }
        }
    } catch (error) {
        console.error('Error loading announcements:', error);
    }
}

// ===== CREATE FUNCTIONS =====
window.showAddTaskModal = async function() {
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    const employees = [];
    employeesSnapshot.forEach(doc => {
        const emp = doc.data();
        employees.push({ id: doc.id, name: emp.fullName });
    });
    
    const employeeOptions = employees.map(emp => `<option value="${emp.id}">${emp.name}</option>`).join('');
    
    Swal.fire({
        title: 'Create New Task',
        html: `
            <input type="text" id="taskTitle" class="swal2-input" placeholder="Task Title">
            <textarea id="taskDescription" class="swal2-textarea" placeholder="Task Description" rows="3"></textarea>
            <select id="taskAssignee" class="swal2-select">
                <option value="">Select Assignee</option>
                ${employeeOptions}
            </select>
            <select id="taskPriority" class="swal2-select">
                <option value="Low">Low Priority</option>
                <option value="Medium" selected>Medium Priority</option>
                <option value="High">High Priority</option>
                <option value="Urgent">Urgent</option>
            </select>
            <input type="date" id="taskDueDate" class="swal2-input" value="${new Date().toISOString().split('T')[0]}">
        `,
        confirmButtonText: 'Create Task',
        showCancelButton: true,
        background: '#000',
        confirmButtonColor: '#6c63ff',
        preConfirm: async () => {
            const title = Swal.getPopup().querySelector('#taskTitle').value;
            const description = Swal.getPopup().querySelector('#taskDescription').value;
            const assigneeId = Swal.getPopup().querySelector('#taskAssignee').value;
            const priority = Swal.getPopup().querySelector('#taskPriority').value;
            const dueDate = Swal.getPopup().querySelector('#taskDueDate').value;
            
            if (!title) {
                Swal.showValidationMessage('Please enter a task title');
                return false;
            }
            
            let assigneeName = 'Unassigned';
            if (assigneeId) {
                const assigneeDoc = await getDoc(doc(db, 'employees', assigneeId));
                assigneeName = assigneeDoc.data()?.fullName || 'Unknown';
            }
            
            await addDoc(collection(db, 'tasks'), {
                title: title,
                description: description,
                priority: priority,
                dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate)) : null,
                assignedTo: assigneeId || null,
                assignedByName: assigneeName,
                createdByName: currentEmployee.fullName,
                status: 'pending',
                createdAt: Timestamp.now()
            });
            
            return true;
        }
    }).then(() => {
        loadTasks();
        loadDashboardData();
        Swal.fire({ title: 'Success', text: 'Task created successfully', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    });
};

window.showAddAppointmentModal = function() {
    const dateTimeInput = document.getElementById('appointmentDateTime');
    if (dateTimeInput) dateTimeInput.value = new Date().toISOString().slice(0, 16);
    const modal = new bootstrap.Modal(document.getElementById('appointmentModal'));
    modal.show();
};

window.createAppointment = async function() {
    const title = document.getElementById('appointmentTitle').value;
    const type = document.getElementById('appointmentType').value;
    const dateTime = document.getElementById('appointmentDateTime').value;
    const duration = parseInt(document.getElementById('appointmentDuration').value);
    const location = document.getElementById('appointmentLocation').value;
    const description = document.getElementById('appointmentDescription').value;
    
    if (!title || !dateTime) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', background: '#000', confirmButtonColor: '#6c63ff' }); return; }
    
    await addDoc(collection(db, 'appointments'), {
        title: title,
        type: type,
        startTime: Timestamp.fromDate(new Date(dateTime)),
        endTime: Timestamp.fromDate(new Date(new Date(dateTime).getTime() + duration * 60000)),
        duration: duration,
        location: location,
        description: description,
        organizerId: currentEmployee.id,
        organizerName: currentEmployee.fullName,
        organizerPosition: currentEmployee.position,
        attendees: [currentEmployee.id],
        status: 'scheduled',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('appointmentModal')).hide();
    Swal.fire({ title: 'Success', text: 'Appointment scheduled successfully', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    await loadAppointments();
    await loadDashboardData();
};

window.showLeaveRequestModal = function() {
    const startInput = document.getElementById('leaveStart');
    const endInput = document.getElementById('leaveEnd');
    if (startInput) startInput.value = new Date().toISOString().split('T')[0];
    if (endInput) endInput.value = new Date().toISOString().split('T')[0];
    const modal = new bootstrap.Modal(document.getElementById('leaveModal'));
    modal.show();
};

window.submitLeaveRequest = async function() {
    const type = document.getElementById('leaveType').value;
    const startDate = document.getElementById('leaveStart').value;
    const endDate = document.getElementById('leaveEnd').value;
    const reason = document.getElementById('leaveReason').value;
    
    if (!startDate || !endDate) { Swal.fire({ title: 'Error', text: 'Please select dates', icon: 'error', background: '#000', confirmButtonColor: '#6c63ff' }); return; }
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    
    await addDoc(collection(db, 'leave_requests'), {
        type: type,
        startDate: startDate,
        endDate: endDate,
        totalDays: days,
        reason: reason,
        employeeId: currentEmployee.id,
        employeeName: currentEmployee.fullName,
        employeePosition: currentEmployee.position,
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('leaveModal')).hide();
    Swal.fire({ title: 'Success', text: 'Leave request submitted successfully', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    await loadLeaveRequests();
};

window.showExpenseModal = function() {
    const expenseDateInput = document.getElementById('expenseDate');
    if (expenseDateInput) expenseDateInput.value = new Date().toISOString().split('T')[0];
    const modal = new bootstrap.Modal(document.getElementById('expenseModal'));
    modal.show();
};

window.submitExpense = async function() {
    const category = document.getElementById('expenseCategory').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const date = document.getElementById('expenseDate').value;
    const description = document.getElementById('expenseDescription').value;
    const receiptFile = document.getElementById('receiptImage').files[0];
    
    if (!category || !amount || !date) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', background: '#000', confirmButtonColor: '#6c63ff' }); return; }
    
    let receiptUrl = '';
    if (receiptFile) {
        const storageRef = ref(storage, `receipts/${currentEmployee.id}/${Date.now()}_${receiptFile.name}`);
        await uploadBytes(storageRef, receiptFile);
        receiptUrl = await getDownloadURL(storageRef);
    }
    
    await addDoc(collection(db, 'expenses'), {
        category: category,
        amount: amount,
        date: date,
        description: description,
        receiptUrl: receiptUrl,
        employeeId: currentEmployee.id,
        employeeName: currentEmployee.fullName,
        employeePosition: currentEmployee.position,
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
    Swal.fire({ title: 'Success', text: 'Expense submitted successfully', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    await loadExpenses();
};

window.updateTaskStatus = async function(taskId, status) {
    await updateDoc(doc(db, 'tasks', taskId), { status: status, completedAt: status === 'completed' ? Timestamp.now() : null });
    Swal.fire({ title: 'Success', text: 'Task updated', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    await loadTasks();
    await loadDashboardData();
};

window.showAddDocumentModal = function() {
    Swal.fire({
        title: 'Upload Document',
        html: `
            <input type="text" id="docTitle" class="swal2-input" placeholder="Document Title">
            <select id="docCategory" class="swal2-select">
                <option>Policy</option><option>Form</option><option>Report</option><option>Other</option>
            </select>
            <input type="file" id="docFile" class="swal2-file" accept=".pdf,.doc,.docx,.jpg,.png">
        `,
        confirmButtonText: 'Upload',
        showCancelButton: true,
        background: '#000',
        confirmButtonColor: '#6c63ff',
        preConfirm: async () => {
            const title = Swal.getPopup().querySelector('#docTitle').value;
            const category = Swal.getPopup().querySelector('#docCategory').value;
            const file = Swal.getPopup().querySelector('#docFile').files[0];
            if (!title || !file) { Swal.showValidationMessage('Please enter title and select file'); return false; }
            
            const storageRef = ref(storage, `documents/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            const fileUrl = await getDownloadURL(storageRef);
            
            await addDoc(collection(db, 'documents'), {
                title: title, category: category, fileUrl: fileUrl, fileType: file.name.split('.').pop(),
                uploadedById: currentEmployee.id, uploadedByName: currentEmployee.fullName,
                uploadedByPosition: currentEmployee.position, createdAt: Timestamp.now()
            });
            return true;
        }
    }).then(() => { loadDocuments(); });
};

window.showAddAnnouncementModal = function() {
    Swal.fire({
        title: 'Post Announcement',
        html: `
            <input type="text" id="announceTitle" class="swal2-input" placeholder="Announcement Title">
            <select id="announcePriority" class="swal2-select"><option>Normal</option><option>High</option><option>Urgent</option></select>
            <textarea id="announceMessage" class="swal2-textarea" placeholder="Announcement Message" rows="4"></textarea>
        `,
        confirmButtonText: 'Post',
        showCancelButton: true,
        background: '#000',
        confirmButtonColor: '#6c63ff',
        preConfirm: async () => {
            const title = Swal.getPopup().querySelector('#announceTitle').value;
            const priority = Swal.getPopup().querySelector('#announcePriority').value;
            const message = Swal.getPopup().querySelector('#announceMessage').value;
            if (!title || !message) { Swal.showValidationMessage('Please fill all fields'); return false; }
            
            await addDoc(collection(db, 'announcements'), {
                title: title, priority: priority, message: message, authorId: currentEmployee.id,
                authorName: currentEmployee.fullName, authorPosition: currentEmployee.position,
                readBy: [], createdAt: Timestamp.now()
            });
            return true;
        }
    }).then(() => { loadAnnouncements(); loadDashboardData(); });
};

window.showAddReviewModal = function() {
    Swal.fire({
        title: 'Select Employee',
        input: 'select',
        inputOptions: async () => {
            const snapshot = await getDocs(collection(db, 'employees'));
            const options = {};
            snapshot.forEach(doc => { const emp = doc.data(); options[doc.id] = `${emp.fullName} (${emp.position})`; });
            return options;
        },
        showCancelButton: true,
        background: '#000',
        confirmButtonColor: '#6c63ff',
        preConfirm: (employeeId) => {
            if (!employeeId) { Swal.showValidationMessage('Please select an employee'); return false; }
            return employeeId;
        }
    }).then((result) => {
        if (result.value) showReviewForm(result.value);
    });
};

function showReviewForm(employeeId) {
    Swal.fire({
        title: 'Performance Review',
        html: `
            <input type="number" id="reviewRating" class="swal2-input" placeholder="Rating (1-5)" min="1" max="5" step="1">
            <textarea id="reviewFeedback" class="swal2-textarea" placeholder="Feedback" rows="4"></textarea>
            <input type="text" id="reviewGoals" class="swal2-input" placeholder="Goals for next period">
        `,
        confirmButtonText: 'Submit Review',
        showCancelButton: true,
        background: '#000',
        confirmButtonColor: '#6c63ff',
        preConfirm: async () => {
            const rating = parseInt(Swal.getPopup().querySelector('#reviewRating').value);
            const feedback = Swal.getPopup().querySelector('#reviewFeedback').value;
            const goals = Swal.getPopup().querySelector('#reviewGoals').value;
            if (!rating || !feedback) { Swal.showValidationMessage('Please fill rating and feedback'); return false; }
            
            const employeeDoc = await getDoc(doc(db, 'employees', employeeId));
            const employee = employeeDoc.data();
            await addDoc(collection(db, 'performance_reviews'), {
                employeeId: employeeId, employeeName: employee.fullName, employeePosition: employee.position,
                rating: rating, feedback: feedback, goals: goals, reviewerId: currentEmployee.id,
                reviewerName: currentEmployee.fullName, reviewerPosition: currentEmployee.position,
                reviewDate: Timestamp.now(), createdAt: Timestamp.now()
            });
            return true;
        }
    }).then(() => { loadPerformanceReviews(); });
};

// ========== CHAT FUNCTIONS ==========
window.showGroupChat = function() {
    currentChatType = 'group';
    currentChatUserId = null;
    document.querySelectorAll('#chatUsersList .chat-user-item').forEach(item => item.classList.remove('active'));
    const firstItem = document.querySelector('#chatUsersList .chat-user-item:first-child');
    if (firstItem) firstItem.classList.add('active');
    loadChatMessages('group', null);
};

window.showDMs = function() {
    currentChatType = 'dm';
    loadChatMessages('dm', currentChatUserId);
};

async function loadChatUsers() {
    const snapshot = await getDocs(collection(db, 'employees'));
    const usersList = document.getElementById('chatUsersList');
    if (!usersList) return;
    
    usersList.innerHTML = `
        <div class="chat-user-item ${currentChatType === 'group' ? 'active' : ''}" onclick="showGroupChat()">
            <div class="chat-user-avatar"><i class="fas fa-users"></i></div>
            <div class="chat-user-info">
                <div class="chat-user-name">Group Chat</div>
                <div class="chat-user-status">Everyone</div>
            </div>
        </div>
        <div class="chat-divider"><hr><span>Direct Messages</span><hr></div>
    `;
    
    snapshot.forEach(doc => {
        const emp = doc.data();
        if (emp.id === currentEmployee.id) return;
        const displayName = emp.nickname || emp.fullName;
        const initial = displayName.charAt(0).toUpperCase();
        usersList.innerHTML += `
            <div class="chat-user-item ${currentChatUserId === doc.id ? 'active' : ''}" onclick="startDM('${doc.id}')">
                ${emp.profilePictureUrl ? 
                    `<img src="${emp.profilePictureUrl}" class="chat-user-avatar" style="object-fit: cover;">` :
                    `<div class="chat-user-avatar">${initial}</div>`
                }
                <div class="chat-user-info">
                    <div class="chat-user-name">${escapeHtml(displayName)}</div>
                    <div class="chat-user-status">${emp.position || 'Employee'}</div>
                </div>
            </div>
        `;
    });
}

window.startDM = function(userId) {
    currentChatType = 'dm';
    currentChatUserId = userId;
    loadChatUsers();
    loadChatMessages('dm', userId);
};

async function loadChatMessages(type, userId) {
    if (chatUnsubscribe) chatUnsubscribe();
    
    let q;
    if (type === 'group') {
        q = query(collection(db, 'chat_messages'), where('type', '==', 'group'), orderBy('timestamp', 'asc'), limit(200));
    } else {
        q = query(collection(db, 'chat_messages'), 
            where('type', '==', 'dm'),
            where('participants', 'array-contains', currentEmployee.id),
            orderBy('timestamp', 'asc'), limit(200));
    }
    
    chatUnsubscribe = onSnapshot(q, async (snapshot) => {
        let messages = [];
        for (const doc of snapshot.docs) {
            const msg = doc.data();
            if (type === 'dm') {
                if (msg.senderId === userId || msg.receiverId === userId || 
                    (msg.senderId === currentEmployee.id && msg.receiverId === userId) ||
                    (msg.senderId === userId && msg.receiverId === currentEmployee.id)) {
                    messages.push({ id: doc.id, ...msg });
                }
            } else {
                messages.push({ id: doc.id, ...msg });
            }
        }
        messages.sort((a, b) => (a.timestamp?.toDate() || 0) - (b.timestamp?.toDate() || 0));
        await displayMessages(messages);
    });
}

async function displayMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    
    for (const msg of messages) {
        const senderDoc = await getDoc(doc(db, 'employees', msg.senderId));
        const sender = senderDoc.data();
        const displayName = sender?.nickname || sender?.fullName || 'Unknown';
        const initial = displayName.charAt(0).toUpperCase();
        const isOwn = msg.senderId === currentEmployee.id;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
        msgDiv.innerHTML = `
            ${!isOwn ? `
                ${sender?.profilePictureUrl ? 
                    `<img src="${sender.profilePictureUrl}" class="chat-message-avatar" style="object-fit: cover;">` :
                    `<div class="chat-message-avatar">${initial}</div>`
                }
            ` : ''}
            <div class="chat-message-bubble">
                <div class="chat-message-name">${escapeHtml(displayName)} ${sender?.nickname ? `(${sender.fullName})` : ''}</div>
                <div class="chat-message-text">${escapeHtml(msg.message)}</div>
                <div class="chat-message-time">${msg.timestamp?.toDate().toLocaleTimeString()}</div>
            </div>
        `;
        container.appendChild(msgDiv);
    }
    container.scrollTop = container.scrollHeight;
}

window.sendChatMessage = async function() {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();
    if (!message) return;
    
    let messageData = {
        message: message,
        senderId: currentEmployee.id,
        senderName: currentEmployee.fullName,
        timestamp: Timestamp.now(),
        type: currentChatType
    };
    
    if (currentChatType === 'dm' && currentChatUserId) {
        messageData.receiverId = currentChatUserId;
        messageData.participants = [currentEmployee.id, currentChatUserId];
    }
    
    await addDoc(collection(db, 'chat_messages'), messageData);
    input.value = '';
}

// ========== PROFILE FUNCTIONS ==========
window.previewProfilePicture = function(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('profilePicturePreview');
            preview.innerHTML = `<img src="${e.target.result}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover;">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

window.updateProfile = async function() {
    const nickname = document.getElementById('nicknameInput').value;
    const profilePicture = document.getElementById('profilePictureInput').files[0];
    
    let profilePictureUrl = currentEmployee.profilePictureUrl;
    
    if (profilePicture) {
        const storageRef = ref(storage, `profilePictures/${currentEmployee.id}/${Date.now()}_${profilePicture.name}`);
        await uploadBytes(storageRef, profilePicture);
        profilePictureUrl = await getDownloadURL(storageRef);
    }
    
    await updateDoc(doc(db, 'employees', currentEmployee.id), {
        nickname: nickname || null,
        profilePictureUrl: profilePictureUrl || null
    });
    
    currentEmployee.nickname = nickname;
    currentEmployee.profilePictureUrl = profilePictureUrl;
    localStorage.setItem('currentUser', JSON.stringify(currentEmployee));
    
    bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
    Swal.fire({ title: 'Success', text: 'Profile updated!', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    
    // Update display
    const displayName = currentEmployee.nickname || currentEmployee.fullName;
    document.getElementById('userRole').innerHTML = `<strong>${currentEmployee.position || 'Employee'}</strong><br><small>${displayName}</small>`;
    loadChatUsers();
};

window.showEditProfileModal = function() {
    document.getElementById('nicknameInput').value = currentEmployee.nickname || '';
    const preview = document.getElementById('profilePicturePreview');
    if (currentEmployee.profilePictureUrl) {
        preview.innerHTML = `<img src="${currentEmployee.profilePictureUrl}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover;">`;
    } else {
        preview.innerHTML = '<i class="fas fa-user fa-3x"></i>';
    }
    const modal = new bootstrap.Modal(document.getElementById('editProfileModal'));
    modal.show();
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== ADMIN FUNCTIONS =====
window.showAdminEmployees = function() {
    loadEmployees();
    document.getElementById('adminContent').innerHTML = `
        <div class="glass-card-inner">
            <div class="card-header-glass">Employee Management</div>
            <div class="table-responsive">
                <table class="glass-table" id="employeesTable">
                    <thead><tr><th>Name</th><th>DSSN</th><th>Department</th><th>Position</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="employeesTableBody"></tbody>
                </table>
            </div>
        </div>
    `;
    loadEmployeesTable();
};

window.showAdminReports = function() {
    document.getElementById('adminContent').innerHTML = `
        <div class="glass-card-inner">
            <div class="card-header-glass">Attendance Reports</div>
            <div class="row p-3">
                <div class="col-md-4"><label>Start Date</label><input type="date" id="reportStart" class="glass-input"></div>
                <div class="col-md-4"><label>End Date</label><input type="date" id="reportEnd" class="glass-input"></div>
                <div class="col-md-4"><label>&nbsp;</label><button class="btn-glass-primary w-100" onclick="generateReport()">Generate Report</button></div>
            </div>
            <div id="reportResults" class="p-3"></div>
        </div>
    `;
};

window.showAdminPayroll = function() {
    document.getElementById('adminContent').innerHTML = `
        <div class="glass-card-inner">
            <div class="card-header-glass">Payroll Management</div>
            <div class="row p-3">
                <div class="col-md-6"><label>Month</label><input type="month" id="payrollMonth" class="glass-input"></div>
                <div class="col-md-6"><label>&nbsp;</label><button class="btn-glass-primary w-100" onclick="calculatePayroll()">Calculate Payroll</button></div>
            </div>
            <div id="payrollResults" class="p-3"></div>
        </div>
    `;
};

window.showAdminAnnouncement = function() {
    document.getElementById('adminContent').innerHTML = `
        <div class="glass-card-inner">
            <div class="card-header-glass">Post Announcement</div>
            <div class="p-3">
                <div class="mb-3"><label>Title</label><input type="text" id="announceTitle" class="glass-input"></div>
                <div class="mb-3"><label>Priority</label><select id="announcePriority" class="glass-input"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
                <div class="mb-3"><label>Message</label><textarea id="announceMessage" rows="4" class="glass-input"></textarea></div>
                <button class="btn-glass-primary" onclick="postAdminAnnouncement()">Post Announcement</button>
            </div>
        </div>
    `;
};

window.postAdminAnnouncement = async function() {
    const title = document.getElementById('announceTitle').value;
    const priority = document.getElementById('announcePriority').value;
    const message = document.getElementById('announceMessage').value;
    
    if (!title || !message) {
        Swal.fire({ title: 'Error', text: 'Please fill all fields', icon: 'error', background: '#000' });
        return;
    }
    
    await addDoc(collection(db, 'announcements'), {
        title: title,
        priority: priority,
        message: message,
        authorId: currentEmployee.id,
        authorName: currentEmployee.fullName,
        authorPosition: currentEmployee.position,
        readBy: [],
        createdAt: Timestamp.now()
    });
    
    Swal.fire({ title: 'Success', text: 'Announcement posted', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
    document.getElementById('announceTitle').value = '';
    document.getElementById('announceMessage').value = '';
    loadAnnouncements();
};

async function loadEmployeesTable() {
    const snapshot = await getDocs(collection(db, 'employees'));
    const tbody = document.getElementById('employeesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    snapshot.forEach(doc => {
        const emp = doc.data();
        tbody.innerHTML += `
            <tr>
                <td>${emp.fullName}</td>
                <td>${emp.dssn}</td>
                <td>${emp.department || '-'}</td>
                <td>${emp.position || '-'}</td>
                <td><span class="status-badge status-present">${emp.status || 'Active'}</span></td>
                <td><button class="btn-glass-sm" onclick="deleteEmployee('${doc.id}')">Delete</button></td>
            </tr>
        `;
    });
}

window.deleteEmployee = async function(employeeId) {
    const result = await Swal.fire({
        title: 'Confirm Delete',
        text: 'Are you sure you want to delete this employee?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete',
        background: '#000'
    });
    
    if (result.isConfirmed) {
        await deleteDoc(doc(db, 'employees', employeeId));
        Swal.fire({ title: 'Deleted', text: 'Employee deleted', icon: 'success', background: '#000', confirmButtonColor: '#6c63ff' });
        loadEmployeesTable();
    }
};

window.generateReport = async function() {
    const startDate = document.getElementById('reportStart').value;
    const endDate = document.getElementById('reportEnd').value;
    
    if (!startDate || !endDate) {
        Swal.fire({ title: 'Error', text: 'Please select date range', icon: 'error', background: '#000' });
        return;
    }
    
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
                    ${Object.values(employeeSummary).map(emp => `<tr><td>${emp.name}</td><td>${emp.present}</td><td>${emp.hours.toFixed(1)} hrs</td>`).join('')}
                </tbody>
            </table>
        </div>
    `;
};

window.calculatePayroll = async function() {
    const month = document.getElementById('payrollMonth').value;
    if (!month) {
        Swal.fire({ title: 'Error', text: 'Please select month', icon: 'error', background: '#000' });
        return;
    }
    
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
        
        const dailyRate = (emp.salary || 0) / 22;
        const hourlyRate = dailyRate / 8;
        const amount = totalHours * hourlyRate;
        
        payroll.push({ name: emp.fullName, position: emp.position, hours: totalHours.toFixed(1), salary: emp.salary || 0, amount: amount.toFixed(2) });
    }
    
    const resultsDiv = document.getElementById('payrollResults');
    resultsDiv.innerHTML = `
        <div class="table-responsive mt-3">
            <table class="glass-table">
                <thead><tr><th>Employee</th><th>Position</th><th>Hours Worked</th><th>Monthly Salary</th><th>Pro-rated Amount</th></tr></thead>
                <tbody>
                    ${payroll.map(p => `<tr><td>${p.name}</td><td>${p.position}</td><td>${p.hours}</td><td>$${p.salary}</td><td>$${p.amount}</td>`).join('')}
                </tbody>
            </table>
        </div>
    `;
};

// ===== SHOW SECTION =====
window.showSection = function(section) {
    const sections = ['dashboard', 'attendance', 'appointments', 'tasks', 'leave', 'expenses', 'documents', 'performance', 'announcements', 'chat', 'admin'];
    sections.forEach(s => {
        const el = document.getElementById(s + 'Section');
        if (el) el.style.display = s === section ? 'block' : 'none';
    });
    
    const activeItem = event?.target?.closest('.glass-nav-item');
    if (activeItem) {
        document.querySelectorAll('.glass-nav-item').forEach(item => item.classList.remove('active'));
        activeItem.classList.add('active');
    }
    
    if (section === 'appointments' && calendar) setTimeout(() => calendar.render(), 100);
    if (section === 'tasks') loadTasks();
    if (section === 'expenses') loadExpenses();
    if (section === 'documents') loadDocuments();
    if (section === 'performance') loadPerformanceReviews();
    if (section === 'announcements') loadAnnouncements();
    if (section === 'chat') {
        loadChatUsers();
        showGroupChat();
    }
};

window.logout = function() {
    localStorage.removeItem('currentUser');
    window.location.reload();
};

// Add SweetAlert2 to the page if not already there
if (typeof Swal === 'undefined') {
    const swalScript = document.createElement('script');
    swalScript.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
    document.head.appendChild(swalScript);
}
