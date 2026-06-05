import { db } from './firebase-config.js';

let currentUser = null;
let currentEmployee = null;
let signaturePad = null;
let canvas = null;
let ctx = null;
let calendar = null;

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
        
        const isAdmin = currentEmployee.role === 'admin' || currentEmployee.role === 'super admin';
        document.getElementById('userRole').innerHTML = `<strong>${currentEmployee.position || 'Employee'}</strong><br><small>${currentEmployee.fullName}</small>`;
        
        if (isAdmin) {
            document.getElementById('adminMenu').style.display = 'block';
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
                Swal.fire({ title: 'Success', text: 'Location captured successfully', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
            },
            (error) => { Swal.fire({ title: 'Error', text: 'Unable to get location: ' + error.message, icon: 'error', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' }); }
        );
    }
};

window.checkIn = async function() {
    if (!window.currentLocation) { Swal.fire({ title: 'Error', text: 'Please capture your location first', icon: 'error', background: 'rgba(0,0,0,0.9)' }); return; }
    
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
        
        Swal.fire({ title: 'Success', text: 'Checked in successfully!', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
        
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');
        const statusDiv = document.getElementById('attendanceStatus');
        
        if (checkInBtn) checkInBtn.style.display = 'none';
        if (checkOutBtn) checkOutBtn.style.display = 'block';
        if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success">✅ Checked In</div>';
        
        await loadAttendanceHistory();
        await loadDashboardData();
    } catch (error) {
        Swal.fire({ title: 'Error', text: 'Check-in failed: ' + error.message, icon: 'error', background: 'rgba(0,0,0,0.9)' });
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
            
            Swal.fire({ title: 'Success', text: 'Checked out successfully!', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
            
            const checkOutBtn = document.getElementById('checkOutBtn');
            const statusDiv = document.getElementById('attendanceStatus');
            
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-info">✅ Completed Today</div>';
            
            await loadAttendanceHistory();
            await loadDashboardData();
        }
    } catch (error) {
        Swal.fire({ title: 'Error', text: 'Check-out failed: ' + error.message, icon: 'error', background: 'rgba(0,0,0,0.9)' });
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
        
        // Recent activities
        const activitiesQ = query(collection(db, 'attendance'), orderBy('createdAt', 'desc'), limit(10));
        const activitiesSnapshot = await getDocs(activitiesQ);
        const activitiesHtml = [];
        activitiesSnapshot.forEach(doc => {
            const data = doc.data();
            activitiesHtml.push(`
                <div class="activity-item glass-card-hover" onclick="showAttendanceDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-clock"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName || 'Employee'}</strong> - ${data.status || 'Checked in'}
                        <small class="d-block text-muted">${data.date} at ${data.checkIn?.toDate().toLocaleTimeString() || ''}</small>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        const recentActivitiesElem = document.getElementById('recentActivities');
        if (recentActivitiesElem) recentActivitiesElem.innerHTML = activitiesHtml.join('') || '<div class="text-center p-3 text-muted">No recent activities</div>';
        
        // Upcoming appointments
        const upcomingQ = query(collection(db, 'appointments'), orderBy('startTime'), limit(10));
        const upcomingSnapshot = await getDocs(upcomingQ);
        const upcomingHtml = [];
        upcomingSnapshot.forEach(doc => {
            const data = doc.data();
            upcomingHtml.push(`
                <div class="schedule-item glass-card-hover" onclick="showAppointmentDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-calendar-alt"></i>
                    <div class="flex-grow-1">
                        <strong>${data.title}</strong>
                        <small class="d-block text-muted">${data.startTime?.toDate().toLocaleString()} by ${data.organizerName || 'Organizer'}</small>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        const upcomingAppointmentsElem = document.getElementById('upcomingAppointments');
        if (upcomingAppointmentsElem) upcomingAppointmentsElem.innerHTML = upcomingHtml.join('') || '<div class="text-center p-3 text-muted">No upcoming appointments</div>';
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Detail View Functions
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
                <p><strong>Assigned To:</strong> ${task.assignedByName || 'Unknown'}</p>
                <p><strong>Due Date:</strong> ${task.dueDate?.toDate().toLocaleDateString() || 'No date'}</p>
                <p><strong>Created By:</strong> ${task.createdByName || task.assignedByName}</p>
                <p><strong>Created At:</strong> ${task.createdAt?.toDate().toLocaleString()}</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#6c63ff',
        background: 'rgba(0,0,0,0.9)',
        backdrop: 'rgba(0,0,0,0.8)'
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
        background: 'rgba(0,0,0,0.9)',
        backdrop: 'rgba(0,0,0,0.8)'
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
        background: 'rgba(0,0,0,0.9)',
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
        background: 'rgba(0,0,0,0.9)',
        backdrop: 'rgba(0,0,0,0.8)'
    });
};

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
                        <small><i class="fas fa-user"></i> Created by: ${data.createdByName || data.assignedByName}</small>
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

// Modal Functions
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
    
    if (!title || !dateTime) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', background: 'rgba(0,0,0,0.9)' }); return; }
    
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
    Swal.fire({ title: 'Success', text: 'Appointment scheduled successfully', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
    await loadAppointments();
    await loadDashboardData();
};

window.showAddTaskModal = function() {
    const dueDateInput = document.getElementById('taskDueDate');
    if (dueDateInput) dueDateInput.value = new Date().toISOString().split('T')[0];
    const modal = new bootstrap.Modal(document.getElementById('taskModal'));
    modal.show();
};

window.createTask = async function() {
    const title = document.getElementById('taskTitle').value;
    const priority = document.getElementById('taskPriority').value;
    const dueDate = document.getElementById('taskDueDate').value;
    const description = document.getElementById('taskDescription').value;
    
    if (!title || !dueDate) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', background: 'rgba(0,0,0,0.9)' }); return; }
    
    await addDoc(collection(db, 'tasks'), {
        title: title,
        priority: priority,
        dueDate: Timestamp.fromDate(new Date(dueDate)),
        description: description,
        assignedTo: currentEmployee.id,
        assignedByName: currentEmployee.fullName,
        createdByName: currentEmployee.fullName,
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
    Swal.fire({ title: 'Success', text: 'Task created successfully', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
    await loadTasks();
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
    
    if (!startDate || !endDate) { Swal.fire({ title: 'Error', text: 'Please select dates', icon: 'error', background: 'rgba(0,0,0,0.9)' }); return; }
    
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
    Swal.fire({ title: 'Success', text: 'Leave request submitted successfully', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
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
    
    if (!category || !amount || !date) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', background: 'rgba(0,0,0,0.9)' }); return; }
    
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
    Swal.fire({ title: 'Success', text: 'Expense submitted successfully', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
    await loadExpenses();
};

window.updateTaskStatus = async function(taskId, status) {
    await updateDoc(doc(db, 'tasks', taskId), { status: status, completedAt: status === 'completed' ? Timestamp.now() : null });
    Swal.fire({ title: 'Success', text: 'Task updated', icon: 'success', background: 'rgba(0,0,0,0.9)', confirmButtonColor: '#6c63ff' });
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
        background: 'rgba(0,0,0,0.9)',
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
        background: 'rgba(0,0,0,0.9)',
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
        background: 'rgba(0,0,0,0.9)',
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
        background: 'rgba(0,0,0,0.9)',
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
}

window.showSection = function(section) {
    const sections = ['dashboard', 'attendance', 'appointments', 'tasks', 'leave', 'expenses', 'documents', 'performance', 'announcements', 'admin'];
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
