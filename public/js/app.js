import { db } from './firebase-config.js';

let currentUser = null;
let currentEmployee = null;
let signaturePad = null;
let canvas = null;
let ctx = null;
let calendar = null;

// Check if user is logged in on page load
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
        
        // Verify user still exists and password is valid
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
    const modal = new bootstrap.Modal(document.getElementById('loginModal'));
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
        
        // Check if password is set
        if (!employee.password) {
            // First time login - show password setup
            currentEmployee = employee;
            document.getElementById('welcomeName').textContent = `Welcome, ${employee.fullName}!`;
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            const setupModal = new bootstrap.Modal(document.getElementById('setupPasswordModal'));
            setupModal.show();
            return;
        }
        
        // Verify password (simple comparison - in production use hashing)
        if (employee.password !== password) {
            messageDiv.textContent = 'Invalid password. Please try again.';
            messageDiv.classList.remove('d-none');
            return;
        }
        
        // Login successful
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
        // Save password to employee record (in production, hash this!)
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
                showToast('Location captured successfully', 'success');
            },
            (error) => { showToast('Unable to get location: ' + error.message, 'error'); }
        );
    }
};

window.checkIn = async function() {
    if (!window.currentLocation) { showToast('Please capture your location first', 'error'); return; }
    
    if (!canvas || !ctx) return;
    const imageData = canvas.toDataURL();
    
    try {
        const today = new Date().toISOString().split('T')[0];
        await addDoc(collection(db, 'attendance'), {
            employeeId: currentEmployee.id,
            employeeName: currentEmployee.fullName,
            employeeDSSN: currentEmployee.dssn,
            date: today,
            checkIn: Timestamp.now(),
            checkInLocation: window.currentLocation,
            signature: imageData,
            notes: document.getElementById('attendanceNotes')?.value || '',
            status: 'present',
            createdAt: Timestamp.now()
        });
        
        showToast('Checked in successfully!', 'success');
        const checkInBtn = document.getElementById('checkInBtn');
        const checkOutBtn = document.getElementById('checkOutBtn');
        const statusDiv = document.getElementById('attendanceStatus');
        
        if (checkInBtn) checkInBtn.style.display = 'none';
        if (checkOutBtn) checkOutBtn.style.display = 'block';
        if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success">✅ Checked In</div>';
        
        await loadAttendanceHistory();
        await loadDashboardData();
    } catch (error) {
        showToast('Check-in failed: ' + error.message, 'error');
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
            
            showToast('Checked out successfully!', 'success');
            const checkOutBtn = document.getElementById('checkOutBtn');
            const statusDiv = document.getElementById('attendanceStatus');
            
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-info">✅ Completed Today</div>';
            
            await loadAttendanceHistory();
            await loadDashboardData();
        }
    } catch (error) {
        showToast('Check-out failed: ' + error.message, 'error');
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
        
        const tasksQ = query(collection(db, 'tasks'), where('assignedTo', '==', currentEmployee.id), where('status', 'in', ['pending', 'in_progress']));
        const tasksSnapshot = await getDocs(tasksQ);
        const pendingTasksElem = document.getElementById('pendingTasks');
        if (pendingTasksElem) pendingTasksElem.textContent = tasksSnapshot.size;
        
        const appointmentsQ = query(collection(db, 'appointments'), where('attendees', 'array-contains', currentEmployee.id), where('startTime', '>=', Timestamp.now()));
        const appointmentsSnapshot = await getDocs(appointmentsQ);
        const todayAppointmentsElem = document.getElementById('todayAppointments');
        if (todayAppointmentsElem) todayAppointmentsElem.textContent = appointmentsSnapshot.size;
        
        const announcementsQ = query(collection(db, 'announcements'), where('readBy', 'not-array-contains', currentEmployee.id));
        const announcementsSnapshot = await getDocs(announcementsQ);
        const unreadAnnouncementsElem = document.getElementById('unreadAnnouncements');
        if (unreadAnnouncementsElem) unreadAnnouncementsElem.textContent = announcementsSnapshot.size;
        
        const activitiesQ = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), orderBy('createdAt', 'desc'), limit(5));
        const activitiesSnapshot = await getDocs(activitiesQ);
        const activitiesHtml = [];
        activitiesSnapshot.forEach(doc => {
            const data = doc.data();
            activitiesHtml.push(`<div class="activity-item"><i class="fas fa-clock"></i> ${data.date} - ${data.checkIn?.toDate().toLocaleTimeString() || 'Checked in'}</div>`);
        });
        const recentActivitiesElem = document.getElementById('recentActivities');
        if (recentActivitiesElem) recentActivitiesElem.innerHTML = activitiesHtml.join('') || '<div class="text-muted">No recent activities</div>';
        
        const upcomingQ = query(collection(db, 'appointments'), where('attendees', 'array-contains', currentEmployee.id), where('startTime', '>=', Timestamp.now()), orderBy('startTime'), limit(5));
        const upcomingSnapshot = await getDocs(upcomingQ);
        const upcomingHtml = [];
        upcomingSnapshot.forEach(doc => {
            const data = doc.data();
            upcomingHtml.push(`<div class="schedule-item"><i class="fas fa-calendar"></i> ${data.title} - ${data.startTime?.toDate().toLocaleString()}</div>`);
        });
        const upcomingAppointmentsElem = document.getElementById('upcomingAppointments');
        if (upcomingAppointmentsElem) upcomingAppointmentsElem.innerHTML = upcomingHtml.join('') || '<div class="text-muted">No upcoming appointments</div>';
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadAttendanceHistory() {
    try {
        const q = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), orderBy('date', 'desc'), limit(30));
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
            tableBody.innerHTML += `<tr>
                <td>${data.date}</td>
                <td>${data.checkIn?.toDate().toLocaleTimeString() || '-'}</td>
                <td>${data.checkOut?.toDate().toLocaleTimeString() || '-'}</td>
                <td>${hours}</td>
                <td><span class="status-badge status-${data.status}">${data.status}</span></td>
            </tr>`;
        });
    } catch (error) {
        console.error('Error loading attendance history:', error);
    }
}

async function loadAppointments() {
    try {
        const q = query(collection(db, 'appointments'), where('attendees', 'array-contains', currentEmployee.id), orderBy('startTime', 'desc'));
        const snapshot = await getDocs(q);
        const tableBody = document.getElementById('appointmentsTable');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            tableBody.innerHTML += `<tr>
                <td>${data.title}</td>
                <td>${data.startTime?.toDate().toLocaleString()}</td>
                <td>${data.type}</td>
                <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                <td><button class="btn-glass-sm" onclick="viewAppointment('${doc.id}')">View</button></td>
            </tr>`;
        });
        
        if (calendar) calendar.destroy();
        const calendarEl = document.getElementById('calendar');
        if (calendarEl) {
            calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
                events: snapshot.docs.map(doc => {
                    const data = doc.data();
                    return { title: data.title, start: data.startTime?.toDate(), extendedProps: { type: data.type } };
                }),
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
            q = query(collection(db, 'tasks'), where('assignedTo', '==', currentEmployee.id), orderBy('dueDate'));
        } else {
            q = query(collection(db, 'tasks'), where('assignedTo', '==', currentEmployee.id), where('status', '==', filter), orderBy('dueDate'));
        }
        const snapshot = await getDocs(q);
        const container = document.getElementById('tasksList');
        if (!container) return;
        container.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const priorityClass = `task-highlight-${data.priority?.toLowerCase() || 'low'}`;
            container.innerHTML += `
                <div class="task-card ${priorityClass}">
                    <div class="d-flex justify-content-between align-items-center">
                        <h6>${data.title}</h6>
                        <span class="status-badge status-${data.status}">${data.status}</span>
                    </div>
                    <p class="small text-muted mt-2">${data.description || ''}</p>
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <small><i class="far fa-calendar-alt"></i> Due: ${data.dueDate?.toDate().toLocaleDateString() || 'No date'}</small>
                        <div>
                            ${data.status !== 'completed' ? `<button class="btn-glass-sm me-2" onclick="updateTaskStatus('${doc.id}', 'completed')">Complete</button>` : ''}
                            <button class="btn-glass-sm" onclick="viewTask('${doc.id}')">View</button>
                        </div>
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
        const q = query(collection(db, 'leave_requests'), where('employeeId', '==', currentEmployee.id), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('leaveRequestsList');
        if (!container) return;
        container.innerHTML = '';
        
        let pending = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.status === 'pending') pending++;
            container.innerHTML += `
                <div class="glass-card-inner p-3 mb-2">
                    <div class="d-flex justify-content-between">
                        <span><strong>${data.type}</strong> - ${data.startDate} to ${data.endDate}</span>
                        <span class="status-badge status-${data.status}">${data.status}</span>
                    </div>
                    <p class="small mt-2">${data.reason}</p>
                    ${data.approvedBy ? `<small class="text-muted">Approved by: ${data.approvedBy}</small>` : ''}
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
        const q = query(collection(db, 'expenses'), where('employeeId', '==', currentEmployee.id), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('expensesList');
        if (!container) return;
        container.innerHTML = '<div class="table-responsive"><table class="glass-table"><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table></div>';
        const tbody = container.querySelector('tbody');
        
        snapshot.forEach(doc => {
            const data = doc.data();
            tbody.innerHTML += `<tr>
                <td>${data.date}</td>
                <td>${data.category}</td>
                <td>$${data.amount}</td>
                <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                <td><button class="btn-glass-sm" onclick="viewExpense('${doc.id}')">View</button></td>
            </tr>`;
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
        container.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            container.innerHTML += `
                <div class="glass-card-inner p-3">
                    <div class="d-flex align-items-center gap-3">
                        <i class="fas fa-file-pdf fa-2x text-danger"></i>
                        <div class="flex-grow-1">
                            <h6>${data.title}</h6>
                            <small class="text-muted">${data.category} • Uploaded: ${data.createdAt?.toDate().toLocaleDateString()}</small>
                        </div>
                        <button class="btn-glass-sm" onclick="window.open('${data.fileUrl}', '_blank')"><i class="fas fa-download"></i> Download</button>
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
        const q = query(collection(db, 'performance_reviews'), where('employeeId', '==', currentEmployee.id), orderBy('reviewDate', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('performanceReviews');
        if (!container) return;
        container.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const rating = data.rating || 0;
            const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
            container.innerHTML += `
                <div class="glass-card-inner p-3 mb-2">
                    <div class="d-flex justify-content-between">
                        <h6>${data.reviewerName} - ${data.reviewDate?.toDate().toLocaleDateString()}</h6>
                        <span>${stars}</span>
                    </div>
                    <p class="mt-2">${data.feedback}</p>
                    <small class="text-muted">Goals: ${data.goals}</small>
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
        container.innerHTML = '';
        
        for (const docSnapshot of snapshot.docs) {
            const data = docSnapshot.data();
            const isRead = data.readBy?.includes(currentEmployee.id);
            container.innerHTML += `
                <div class="glass-card-inner p-3 mb-2 ${isRead ? '' : 'border-primary'}">
                    <div class="d-flex justify-content-between">
                        <h6><i class="fas fa-bullhorn"></i> ${data.title}</h6>
                        <span class="badge ${data.priority === 'Urgent' ? 'bg-danger' : 'bg-primary'}">${data.priority || 'Normal'}</span>
                    </div>
                    <p class="mt-2">${data.message}</p>
                    <small class="text-muted">Posted: ${data.createdAt?.toDate().toLocaleString()} by ${data.authorName}</small>
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
    
    if (!title || !dateTime) { showToast('Please fill required fields', 'error'); return; }
    
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
        attendees: [currentEmployee.id],
        status: 'scheduled',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('appointmentModal')).hide();
    showToast('Appointment scheduled successfully', 'success');
    await loadAppointments();
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
    
    if (!title || !dueDate) { showToast('Please fill required fields', 'error'); return; }
    
    await addDoc(collection(db, 'tasks'), {
        title: title,
        priority: priority,
        dueDate: Timestamp.fromDate(new Date(dueDate)),
        description: description,
        assignedTo: currentEmployee.id,
        assignedByName: currentEmployee.fullName,
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('taskModal')).hide();
    showToast('Task created successfully', 'success');
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
    
    if (!startDate || !endDate) { showToast('Please select dates', 'error'); return; }
    
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    
    await addDoc(collection(db, 'leave_requests'), {
        type: type,
        startDate: startDate,
        endDate: endDate,
        totalDays: days,
        reason: reason,
        employeeId: currentEmployee.id,
        employeeName: currentEmployee.fullName,
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('leaveModal')).hide();
    showToast('Leave request submitted successfully', 'success');
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
    
    if (!category || !amount || !date) { showToast('Please fill required fields', 'error'); return; }
    
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
        status: 'pending',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
    showToast('Expense submitted successfully', 'success');
    await loadExpenses();
};

window.updateTaskStatus = async function(taskId, status) {
    await updateDoc(doc(db, 'tasks', taskId), { status: status, completedAt: status === 'completed' ? Timestamp.now() : null });
    showToast('Task updated', 'success');
    await loadTasks();
    await loadDashboardData();
};

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

function showToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i> ${message}`;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#4caf50' : '#f44336'};
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
