import { db } from './firebase-config.js';
import { 
    collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, 
    doc, Timestamp, orderBy, limit, getDoc, onSnapshot, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ========== THEME TOGGLE SUPPORT ==========
(function initTheme() {
    const saved = localStorage.getItem('hrTheme');
    if (saved === 'light') {
        document.body.classList.add('light-mode');
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        if (icon) icon.className = 'fas fa-sun';
        if (label) label.textContent = 'Light';
    } else {
        document.body.classList.remove('light-mode');
        const icon = document.getElementById('themeIcon');
        const label = document.getElementById('themeLabel');
        if (icon) icon.className = 'fas fa-moon';
        if (label) label.textContent = 'Dark';
    }
})();

window.toggleTheme = function() {
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    const label = document.getElementById('themeLabel');
    if (body.classList.contains('light-mode')) {
        body.classList.remove('light-mode');
        if (icon) icon.className = 'fas fa-moon';
        if (label) label.textContent = 'Dark';
        localStorage.setItem('hrTheme', 'dark');
    } else {
        body.classList.add('light-mode');
        if (icon) icon.className = 'fas fa-sun';
        if (label) label.textContent = 'Light';
        localStorage.setItem('hrTheme', 'light');
    }
};

let currentUser = null;
let currentEmployee = null;
let calendar = null;

// Chat variables
let currentChatType = 'group';
let currentChatUserId = null;
let chatUnsubscribe = null;

// Attendance tracking variables
let attendanceCheckInTime = null;
let attendanceCheckOutTime = null;
let attendanceIntervalId = null;
let isAttendanceCheckedIn = false;
let isAttendanceCheckedOut = false;

// ========== OFFICE LOCATION ==========
const OFFICE_LOCATION = {
    lat: 6.2923,
    lng: -10.7740
};

const ALLOWED_RADIUS_METERS = 5000;
let currentUserLocation = null;
let locationVerified = false;

// ========== UTILITY FUNCTIONS ==========

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c * 1000;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(seconds) {
    if (seconds < 0) return '0s';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

function formatCurrency(amount, currency = 'USD') {
    const symbol = currency === 'LRD' ? 'L$' : '$';
    return symbol + parseFloat(amount).toFixed(2);
}

function getCurrencySymbol(currency) {
    return currency === 'LRD' ? 'L$' : '$';
}

function getDateRange(type) {
    const now = new Date();
    let startDate, endDate;
    const today = now.toISOString().split('T')[0];
    
    switch(type) {
        case 'daily':
            startDate = today;
            endDate = today;
            break;
        case 'weekly':
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            startDate = weekStart.toISOString().split('T')[0];
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            endDate = weekEnd.toISOString().split('T')[0];
            break;
        case 'monthly':
            startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
            break;
        default:
            startDate = today;
            endDate = today;
    }
    return { startDate, endDate };
}

// ========== INITIALIZATION ==========
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
        
        const userRole = currentEmployee['role '] || currentEmployee.role || 'employee';
        const isAdmin = userRole === 'admin' || userRole === 'super admin';
        
        const displayName = currentEmployee.nickname || currentEmployee.fullName;
        document.getElementById('userRole').innerHTML = `<strong>${currentEmployee.position || 'Employee'}</strong><br><small>${displayName}</small>`;
        
        const adminMenu = document.getElementById('adminMenu');
        if (adminMenu) adminMenu.style.display = isAdmin ? 'block' : 'none';
        
        const adminNavBtn = document.getElementById('adminNavBtn');
        if (adminNavBtn) adminNavBtn.style.display = isAdmin ? 'inline-block' : 'none';
        
        const editProfileBtn = document.getElementById('editProfileBtn');
        if (editProfileBtn) editProfileBtn.style.display = 'inline-block';
        
        setupRealtimeAttendance();
        
        await loadDashboardData();
        await loadAttendanceHistory();
        await loadAppointments();
        await loadTasks();
        await loadLeaveRequests();
        await loadExpenses();
        await loadDocuments();
        await loadPerformanceReviews();
        await loadAnnouncements();
        
        updateAttendanceUI();
        addChatAttachmentButtons();
        
        const attendanceObserver = new MutationObserver(() => {
            const attendanceSection = document.getElementById('attendanceSection');
            if (attendanceSection && attendanceSection.style.display !== 'none') {
                getLocation();
                attendanceObserver.disconnect();
            }
        });
        attendanceObserver.observe(document.getElementById('attendanceSection'), { attributes: true, attributeFilter: ['style'] });
        
    } catch (error) {
        console.error('Error loading user:', error);
        localStorage.removeItem('currentUser');
        showLoginModal();
    }
});

// ========== REAL-TIME ATTENDANCE LISTENER ==========
function setupRealtimeAttendance() {
    const today = new Date().toISOString().split('T')[0];
    const q = query(collection(db, 'attendance'), 
        where('employeeId', '==', currentEmployee?.id), 
        where('date', '==', today)
    );
    
    onSnapshot(q, (snapshot) => {
        let hasCheckIn = false;
        let hasCheckOut = false;
        let checkInTime = null;
        let checkOutTime = null;
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.checkIn) {
                hasCheckIn = true;
                checkInTime = data.checkIn.toDate();
            }
            if (data.checkOut) {
                hasCheckOut = true;
                checkOutTime = data.checkOut.toDate();
            }
        });
        
        isAttendanceCheckedIn = hasCheckIn;
        isAttendanceCheckedOut = hasCheckOut;
        
        if (hasCheckIn && !hasCheckOut) {
            attendanceCheckInTime = checkInTime;
            if (attendanceIntervalId) {
                clearInterval(attendanceIntervalId);
            }
            attendanceIntervalId = setInterval(() => {
                updateTodayHours();
            }, 1000);
            updateTodayHours();
        } else if (hasCheckIn && hasCheckOut) {
            if (attendanceIntervalId) {
                clearInterval(attendanceIntervalId);
                attendanceIntervalId = null;
            }
            updateTodayHours();
        } else {
            if (attendanceIntervalId) {
                clearInterval(attendanceIntervalId);
                attendanceIntervalId = null;
            }
            const todayHoursElem = document.getElementById('todayHours');
            if (todayHoursElem) todayHoursElem.textContent = '0s';
        }
        
        updateAttendanceUI();
        loadAttendanceHistory();
    });
}

// ========== UPDATE TODAY'S HOURS ==========
function updateTodayHours() {
    const todayHoursElem = document.getElementById('todayHours');
    if (!todayHoursElem) return;
    
    if (isAttendanceCheckedIn && !isAttendanceCheckedOut && attendanceCheckInTime) {
        const now = new Date();
        const diffSeconds = (now - attendanceCheckInTime) / 1000;
        todayHoursElem.textContent = formatTime(diffSeconds);
    } else if (isAttendanceCheckedIn && isAttendanceCheckedOut) {
        const today = new Date().toISOString().split('T')[0];
        const q = query(collection(db, 'attendance'), 
            where('employeeId', '==', currentEmployee?.id), 
            where('date', '==', today)
        );
        getDocs(q).then(snapshot => {
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.checkIn && data.checkOut) {
                    const checkIn = data.checkIn.toDate();
                    const checkOut = data.checkOut.toDate();
                    const hours = (checkOut - checkIn) / (1000 * 60 * 60);
                    todayHoursElem.textContent = hours.toFixed(1) + 'h';
                }
            });
        });
    } else {
        todayHoursElem.textContent = '0s';
    }
}

// ========== CHAT ATTACHMENT ==========
function addChatAttachmentButtons() {
    const chatInputContainer = document.querySelector('.chat-input-container .d-flex');
    if (chatInputContainer && !document.getElementById('chatAttachmentBtn')) {
        const attachmentGroup = document.createElement('div');
        attachmentGroup.className = 'd-flex gap-2';
        attachmentGroup.innerHTML = `
            <button id="chatImageBtn" class="btn-glass-sm" title="Send Image">
                <i class="fas fa-image"></i>
            </button>
            <button id="chatFileBtn" class="btn-glass-sm" title="Send File">
                <i class="fas fa-paperclip"></i>
            </button>
            <input type="file" id="chatImageInput" accept="image/*" style="display: none;">
            <input type="file" id="chatFileInput" style="display: none;">
        `;
        chatInputContainer.insertBefore(attachmentGroup, chatInputContainer.firstChild);
        
        document.getElementById('chatImageBtn').onclick = () => document.getElementById('chatImageInput').click();
        document.getElementById('chatFileBtn').onclick = () => document.getElementById('chatFileInput').click();
        document.getElementById('chatImageInput').onchange = () => sendMediaMessage('image');
        document.getElementById('chatFileInput').onchange = () => sendMediaMessage('file');
    }
}

async function sendMediaMessage(type) {
    let file = null;
    let inputElement = null;
    
    if (type === 'image') {
        inputElement = document.getElementById('chatImageInput');
        file = inputElement.files[0];
    } else if (type === 'file') {
        inputElement = document.getElementById('chatFileInput');
        file = inputElement.files[0];
    }
    
    if (!file) return;
    
    Swal.fire({ title: 'Uploading...', text: 'Please wait', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    try {
        const timestamp = Date.now();
        const fileExtension = file.name ? file.name.split('.').pop() : 'bin';
        const filePath = `chat_files/${currentChatType}/${currentChatUserId || 'group'}/${timestamp}_${type}.${fileExtension}`;
        const storageRef = ref(storage, filePath);
        await uploadBytes(storageRef, file);
        const downloadUrl = await getDownloadURL(storageRef);
        
        let messageData = {
            senderId: currentEmployee.id,
            senderName: currentEmployee.fullName,
            timestamp: Timestamp.now(),
            type: currentChatType,
            readBy: [currentEmployee.id],
            mediaType: type,
            mediaUrl: downloadUrl
        };
        
        if (type === 'image') {
            messageData.message = '📷 Sent an image';
            messageData.thumbnail = downloadUrl;
        } else if (type === 'file') {
            messageData.message = `📎 Sent a file: ${file.name}`;
            messageData.fileName = file.name;
            messageData.fileSize = file.size;
        }
        
        if (currentChatType === 'dm' && currentChatUserId) {
            messageData.receiverId = currentChatUserId;
            messageData.participants = [currentEmployee.id, currentChatUserId];
        }
        
        await addDoc(collection(db, 'chat_messages'), messageData);
        
        if (inputElement) inputElement.value = '';
        Swal.close();
        
    } catch (error) {
        Swal.close();
        Swal.fire({ title: 'Error', text: 'Failed to upload file', icon: 'error' });
    }
}

// ========== LOGIN / AUTH ==========
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

// ========== LOCATION VERIFICATION ==========
window.getLocation = function() {
    const locationStatus = document.getElementById('locationStatus');
    const locationDisplay = document.getElementById('locationDisplay');
    
    if (!navigator.geolocation) {
        locationStatus.className = 'location-status error';
        locationStatus.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Geolocation not supported';
        Swal.fire({ 
            title: 'Error', 
            text: 'Geolocation is not supported by your browser.', 
            icon: 'error',
            confirmButtonColor: '#fff'
        });
        return;
    }

    locationStatus.className = 'location-status unverified';
    locationStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Getting your location...';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            
            currentUserLocation = { lat: userLat, lng: userLng };
            
            const distance = calculateDistance(
                userLat, userLng,
                OFFICE_LOCATION.lat, OFFICE_LOCATION.lng
            );
            
            locationDisplay.value = `Lat: ${userLat.toFixed(6)}, Lng: ${userLng.toFixed(6)} | Distance: ${distance.toFixed(1)}m from office`;
            
            if (distance <= ALLOWED_RADIUS_METERS) {
                locationVerified = true;
                locationStatus.className = 'location-status verified';
                locationStatus.innerHTML = `<i class="fas fa-check-circle"></i> ✅ Within ${ALLOWED_RADIUS_METERS}m of office (${distance.toFixed(1)}m)`;
            } else {
                locationVerified = false;
                locationStatus.className = 'location-status error';
                locationStatus.innerHTML = `<i class="fas fa-times-circle"></i> ❌ ${distance.toFixed(1)}m from office. Must be within ${ALLOWED_RADIUS_METERS}m.`;
            }
            
            updateAttendanceUI();
        },
        (error) => {
            locationStatus.className = 'location-status error';
            locationStatus.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Error: ${error.message}`;
            Swal.fire({
                title: 'Location Error',
                text: 'Unable to get your location. Please enable GPS and try again.',
                icon: 'error',
                confirmButtonColor: '#fff'
            });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
};

// ========== ATTENDANCE FUNCTIONS ==========
window.checkIn = async function() {
    if (!locationVerified) {
        Swal.fire({
            title: 'Location Required',
            text: 'Please verify your location first. Click "Get Location & Verify" to proceed.',
            icon: 'warning',
            confirmButtonColor: '#fff'
        });
        return;
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        
        const q = query(collection(db, 'attendance'), 
            where('employeeId', '==', currentEmployee.id), 
            where('date', '==', today)
        );
        const snapshot = await getDocs(q);
        
        let existingRecord = null;
        snapshot.forEach(doc => {
            existingRecord = { id: doc.id, ...doc.data() };
        });
        
        if (existingRecord && existingRecord.checkIn) {
            Swal.fire({
                title: 'Already Checked In',
                text: 'You have already checked in today.',
                icon: 'info',
                confirmButtonColor: '#fff'
            });
            return;
        }

        const distance = calculateDistance(
            currentUserLocation.lat, currentUserLocation.lng,
            OFFICE_LOCATION.lat, OFFICE_LOCATION.lng
        );

        await addDoc(collection(db, 'attendance'), {
            employeeId: currentEmployee.id,
            employeeName: currentEmployee.fullName,
            employeeDSSN: currentEmployee.dssn,
            employeePosition: currentEmployee.position,
            date: today,
            checkIn: Timestamp.now(),
            checkInLocation: currentUserLocation,
            checkInVerified: true,
            officeDistance: distance,
            status: 'present',
            createdAt: Timestamp.now()
        });
        
        Swal.fire({
            title: '✅ Checked In',
            text: `Checked in (${distance.toFixed(1)}m from office)`,
            icon: 'success',
            confirmButtonColor: '#fff'
        });
        
        updateAttendanceUI();
        await loadAttendanceHistory();
        await loadDashboardData();
        
    } catch (error) {
        console.error('Check-in error:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to check in: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
};

window.checkOut = async function() {
    if (!locationVerified) {
        Swal.fire({
            title: 'Location Required',
            text: 'Please verify your location first.',
            icon: 'warning',
            confirmButtonColor: '#fff'
        });
        return;
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const q = query(collection(db, 'attendance'), 
            where('employeeId', '==', currentEmployee.id), 
            where('date', '==', today)
        );
        const snapshot = await getDocs(q);
        
        let attendanceId = null;
        snapshot.forEach(doc => { attendanceId = doc.id; });
        
        if (!attendanceId) {
            Swal.fire({
                title: 'Not Checked In',
                text: 'You need to check in first before checking out.',
                icon: 'warning',
                confirmButtonColor: '#fff'
            });
            return;
        }
        
        await updateDoc(doc(db, 'attendance', attendanceId), {
            checkOut: Timestamp.now(),
            checkOutLocation: currentUserLocation,
            checkOutVerified: true,
            updatedAt: Timestamp.now()
        });
        
        Swal.fire({
            title: '✅ Checked Out',
            text: 'Have a great day!',
            icon: 'success',
            confirmButtonColor: '#fff'
        });
        
        updateAttendanceUI();
        await loadAttendanceHistory();
        await loadDashboardData();
        
    } catch (error) {
        console.error('Check-out error:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to check out: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
};

async function updateAttendanceUI() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const q = query(collection(db, 'attendance'), 
            where('employeeId', '==', currentEmployee.id), 
            where('date', '==', today)
        );
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
            if (checkInBtn) { checkInBtn.style.display = 'inline-block'; checkInBtn.disabled = !locationVerified; }
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-warning">⏰ Not Checked In Yet</div>';
        } else if (hasCheckIn && !hasCheckOut) {
            if (checkInBtn) checkInBtn.style.display = 'none';
            if (checkOutBtn) { checkOutBtn.style.display = 'inline-block'; checkOutBtn.disabled = !locationVerified; }
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success">✅ Checked In - Time Elapsed: <span id="timeElapsed">0s</span></div>';
        } else {
            if (checkInBtn) checkInBtn.style.display = 'none';
            if (checkOutBtn) checkOutBtn.style.display = 'none';
            if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-info">✅ Completed Today</div>';
        }
    } catch (error) {
        console.error('Error updating attendance UI:', error);
    }
}

// ========== DASHBOARD ==========
async function loadDashboardData() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const attendanceQ = query(collection(db, 'attendance'), where('employeeId', '==', currentEmployee.id), where('date', '==', today));
        const attendanceSnapshot = await getDocs(attendanceQ);
        
        let hours = 0;
        let checkInTime = null;
        let checkOutTime = null;
        attendanceSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.checkIn) {
                checkInTime = data.checkIn.toDate();
            }
            if (data.checkIn && data.checkOut) {
                const checkIn = data.checkIn.toDate();
                const checkOut = data.checkOut.toDate();
                hours = (checkOut - checkIn) / (1000 * 60 * 60);
                checkOutTime = checkOut;
            }
        });
        
        const todayHoursElem = document.getElementById('todayHours');
        if (todayHoursElem) {
            if (checkInTime && !checkOutTime) {
                // Currently checked in - live timer will handle this
            } else if (checkInTime && checkOutTime) {
                todayHoursElem.textContent = hours.toFixed(1) + 'h';
            } else {
                todayHoursElem.textContent = '0s';
            }
        }
        
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
            const elapsed = data.checkIn && data.checkOut ? 
                formatTime((data.checkOut.toDate() - data.checkIn.toDate()) / 1000) : 
                'In progress';
            activitiesHtml.push(`
                <div class="activity-item glass-card-hover" onclick="showAttendanceDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-clock"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName || 'Employee'}</strong> - ${data.status || 'Checked in'}
                        <small class="d-block text-muted">${data.date} at ${data.checkIn?.toDate().toLocaleTimeString() || ''} (${elapsed})</small>
                    </div>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        const recentActivitiesElem = document.getElementById('recentActivities');
        if (recentActivitiesElem) recentActivitiesElem.innerHTML = activitiesHtml.join('') || '<div class="text-center p-3 text-muted">No recent activities</div>';
        
        // Upcoming appointments
        const upcomingQ = query(collection(db, 'appointments'), where('startTime', '>=', Timestamp.now()), orderBy('startTime'), limit(10));
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
        
        // Recent Tasks
        const recentTasksQ = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(10));
        const recentTasksSnapshot = await getDocs(recentTasksQ);
        const tasksHtml = [];
        recentTasksSnapshot.forEach(doc => {
            const data = doc.data();
            const priorityColor = data.priority === 'High' ? '#f44336' : data.priority === 'Medium' ? '#ff9800' : '#4caf50';
            tasksHtml.push(`
                <div class="task-card-mini glass-card-hover" onclick="showTaskDetail('${doc.id}')" style="cursor: pointer; border-left: 3px solid ${priorityColor};">
                    <i class="fas fa-tasks"></i>
                    <div class="flex-grow-1">
                        <strong>${data.title}</strong>
                        <small class="d-block text-muted">Assigned to: ${data.assignedByName || 'Unassigned'} | Due: ${data.dueDate?.toDate().toLocaleDateString() || 'No date'}</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        
        // Recent Leave Requests
        const leaveQ = query(collection(db, 'leave_requests'), orderBy('createdAt', 'desc'), limit(10));
        const leaveSnapshot = await getDocs(leaveQ);
        const leaveHtml = [];
        leaveSnapshot.forEach(doc => {
            const data = doc.data();
            leaveHtml.push(`
                <div class="leave-card-mini glass-card-hover" onclick="showLeaveDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-umbrella-beach"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName}</strong> - ${data.type}
                        <small class="d-block text-muted">${data.startDate} to ${data.endDate} (${data.totalDays} days)</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        
        // Recent Expenses
        const expensesQ = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'), limit(10));
        const expensesSnapshot = await getDocs(expensesQ);
        const expensesHtml = [];
        expensesSnapshot.forEach(doc => {
            const data = doc.data();
            const currency = data.currency || 'USD';
            expensesHtml.push(`
                <div class="expense-card-mini glass-card-hover" onclick="showExpenseDetail('${doc.id}')" style="cursor: pointer;">
                    <i class="fas fa-receipt"></i>
                    <div class="flex-grow-1">
                        <strong>${data.employeeName}</strong> - ${data.category}
                        <small class="d-block text-muted">${formatCurrency(data.amount, currency)} - ${data.date}</small>
                    </div>
                    <span class="status-badge status-${data.status}">${data.status || 'pending'}</span>
                    <i class="fas fa-chevron-right"></i>
                </div>
            `);
        });
        
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

// ========== DETAIL VIEW FUNCTIONS ==========
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
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
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
    
    const distance = att.officeDistance ? `${att.officeDistance.toFixed(1)}m` : 'N/A';
    const elapsed = att.checkIn && att.checkOut ? 
        formatTime((att.checkOut.toDate() - att.checkIn.toDate()) / 1000) : 
        'In progress';
    
    Swal.fire({
        title: `${att.employeeName}'s Attendance`,
        html: `
            <div class="text-start">
                <p><strong>Date:</strong> ${att.date}</p>
                <p><strong>Check In:</strong> ${att.checkIn?.toDate().toLocaleTimeString() || 'Not checked in'}</p>
                <p><strong>Check Out:</strong> ${att.checkOut?.toDate().toLocaleTimeString() || 'Not checked out'}</p>
                <p><strong>Total Time:</strong> ${elapsed}</p>
                <p><strong>Status:</strong> <span class="badge bg-${att.status === 'present' ? 'success' : 'warning'}">${att.status}</span></p>
                <p><strong>Distance from Office:</strong> ${distance}</p>
                <p><strong>Verified:</strong> ${att.checkInVerified ? '✅ Yes' : '❌ No'}</p>
                <p><strong>Employee:</strong> ${att.employeeName} (${att.employeePosition || 'Staff'})</p>
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
        backdrop: 'rgba(0,0,0,0.9)'
    });
};

window.showExpenseDetail = async function(expenseId) {
    const expenseDoc = await getDoc(doc(db, 'expenses', expenseId));
    if (!expenseDoc.exists()) return;
    const expense = expenseDoc.data();
    const currency = expense.currency || 'USD';
    
    Swal.fire({
        title: `${expense.employeeName}'s Expense`,
        html: `
            <div class="text-start">
                <p><strong>Category:</strong> ${expense.category}</p>
                <p><strong>Amount:</strong> ${formatCurrency(expense.amount, currency)}</p>
                <p><strong>Currency:</strong> ${currency}</p>
                <p><strong>Date:</strong> ${expense.date}</p>
                <p><strong>Description:</strong><br>${expense.description || 'No description'}</p>
                <p><strong>Status:</strong> <span class="badge bg-${expense.status === 'approved' ? 'success' : expense.status === 'rejected' ? 'danger' : 'warning'}">${expense.status}</span></p>
                ${expense.receiptUrl ? `<p><strong>Receipt:</strong> <a href="${expense.receiptUrl}" target="_blank" style="color: #fff;">View Receipt</a></p>` : ''}
                ${expense.approvedBy ? `<p><strong>Approved By:</strong> ${expense.approvedByName || 'Admin'}</p>` : ''}
                ${expense.approvedAt ? `<p><strong>Approved On:</strong> ${expense.approvedAt.toDate().toLocaleString()}</p>` : ''}
            </div>
        `,
        icon: 'info',
        confirmButtonColor: '#fff',
        backdrop: 'rgba(0,0,0,0.9)'
    });
};

// ========== LOAD FUNCTIONS ==========
async function loadAttendanceHistory() {
    try {
        const q = query(collection(db, 'attendance'), 
            where('employeeId', '==', currentEmployee.id),
            orderBy('date', 'desc'), 
            limit(30)
        );
        const snapshot = await getDocs(q);
        const tableBody = document.getElementById('attendanceHistoryTable');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            let hours = '-';
            let elapsed = '-';
            if (data.checkIn && data.checkOut) {
                const checkIn = data.checkIn.toDate();
                const checkOut = data.checkOut.toDate();
                hours = ((checkOut - checkIn) / (1000 * 60 * 60)).toFixed(1);
                elapsed = formatTime((checkOut - checkIn) / 1000);
            } else if (data.checkIn) {
                elapsed = 'In progress';
            }
            
            const locationStr = data.officeDistance ? 
                `${data.officeDistance.toFixed(0)}m from office` : 
                'Unknown';
            
            tableBody.innerHTML += `
                <tr onclick="showAttendanceDetail('${doc.id}')" style="cursor: pointer;">
                    <td>${data.date}</td>
                    <td>${data.checkIn?.toDate().toLocaleTimeString() || '-'}</td>
                    <td>${data.checkOut?.toDate().toLocaleTimeString() || '-'}</td>
                    <td>${elapsed}</td>
                    <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                    <td><small>${locationStr}</small></td>
                </tr>
            `;
        });
    } catch (error) {
        console.error('Error loading attendance history:', error);
    }
}

// ========== APPOINTMENTS ==========
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

// ========== TASKS ==========
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
            container.innerHTML += `
                <div class="task-card" onclick="showTaskDetail('${doc.id}')" style="cursor: pointer;">
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

// ========== LEAVE REQUESTS ==========
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

// ========== EXPENSES (ENHANCED WITH REPORTS & CURRENCY) ==========
async function loadExpenses() {
    try {
        const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);
        const container = document.getElementById('expensesList');
        if (!container) return;
        
        // Build the expenses table with enhanced UI
        container.innerHTML = `
            <div class="row mb-3">
                <div class="col-12">
                    <div class="d-flex flex-wrap gap-2">
                        <button class="btn-glass-primary btn-sm" onclick="generateExpenseReport('daily')">
                            <i class="fas fa-calendar-day"></i> Daily Report
                        </button>
                        <button class="btn-glass-primary btn-sm" onclick="generateExpenseReport('weekly')">
                            <i class="fas fa-calendar-week"></i> Weekly Report
                        </button>
                        <button class="btn-glass-primary btn-sm" onclick="generateExpenseReport('monthly')">
                            <i class="fas fa-calendar-alt"></i> Monthly Report
                        </button>
                        <button class="btn-glass-primary btn-sm" onclick="showExpenseSummary()">
                            <i class="fas fa-chart-pie"></i> Summary
                        </button>
                    </div>
                </div>
            </div>
            <div class="table-responsive">
                <table class="glass-table">
                    <thead>
                        <tr>
                            <th>Employee</th>
                            <th>Date</th>
                            <th>Category</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="expensesTableBody"></tbody>
                </table>
            </div>
        `;
        
        const tbody = document.getElementById('expensesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        const isAdmin = currentEmployee.role === 'admin' || currentEmployee.role === 'super admin';
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const isPending = data.status === 'pending';
            const isOwnExpense = data.employeeId === currentEmployee.id;
            const currency = data.currency || 'USD';
            const currencyClass = currency === 'LRD' ? 'currency-lrd' : 'currency-usd';
            
            const canEdit = isOwnExpense && isPending;
            const canDelete = isOwnExpense && isPending;
            const canConfirm = isAdmin && isPending;
            
            tbody.innerHTML += `
                <tr>
                    <td>${data.employeeName} <small class="text-muted d-block">${data.employeePosition || ''}</small></td>
                    <td>${data.date}</td>
                    <td>${data.category}</td>
                    <td>
                        <strong>${formatCurrency(data.amount, currency)}</strong>
                        <span class="currency-badge ${currencyClass}">${currency}</span>
                    </td>
                    <td><span class="status-badge status-${data.status}">${data.status}</span></td>
                    <td>
                        <button class="btn-glass-sm me-1" onclick="showExpenseDetail('${doc.id}')" title="View Details">
                            <i class="fas fa-eye"></i>
                        </button>
                        ${canEdit ? `<button class="btn-glass-sm me-1" onclick="showEditExpenseModal('${doc.id}')" style="background: rgba(255, 152, 0, 0.2); border-color: #ff9800;" title="Edit"><i class="fas fa-edit"></i></button>` : ''}
                        ${canConfirm ? `<button class="btn-glass-sm me-1" onclick="confirmExpense('${doc.id}')" style="background: rgba(76, 175, 80, 0.2); border-color: #4caf50;" title="Approve"><i class="fas fa-check-circle"></i></button>` : ''}
                        ${canDelete ? `<button class="btn-glass-sm" onclick="deleteExpense('${doc.id}')" style="background: rgba(191, 10, 48, 0.2); border-color: #BF0A30;" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
                    </td>
                </tr>
            `;
        });
        
        if (snapshot.size === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4">No expenses recorded yet</td></tr>';
        }
    } catch (error) {
        console.error('Error loading expenses:', error);
    }
}

// ========== EXPENSE REPORT GENERATION ==========
window.generateExpenseReport = async function(type) {
    try {
        const { startDate, endDate } = getDateRange(type);
        const q = query(collection(db, 'expenses'), where('date', '>=', startDate), where('date', '<=', endDate));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            Swal.fire({
                title: 'No Expenses Found',
                text: `No expenses recorded for ${type} period (${startDate} to ${endDate})`,
                icon: 'info',
                confirmButtonColor: '#fff'
            });
            return;
        }
        
        let totalUSD = 0;
        let totalLRD = 0;
        let pendingUSD = 0;
        let pendingLRD = 0;
        let approvedUSD = 0;
        let approvedLRD = 0;
        const categoryTotals = {};
        const employeeTotals = {};
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const amount = parseFloat(data.amount) || 0;
            const currency = data.currency || 'USD';
            
            if (currency === 'USD') {
                totalUSD += amount;
                if (data.status === 'pending') pendingUSD += amount;
                if (data.status === 'approved') approvedUSD += amount;
            } else {
                totalLRD += amount;
                if (data.status === 'pending') pendingLRD += amount;
                if (data.status === 'approved') approvedLRD += amount;
            }
            
            const key = `${data.category} (${currency})`;
            if (!categoryTotals[key]) categoryTotals[key] = 0;
            categoryTotals[key] += amount;
            
            if (!employeeTotals[data.employeeName]) employeeTotals[data.employeeName] = 0;
            employeeTotals[data.employeeName] += amount;
        });
        
        // Build category breakdown
        let categoryHtml = '';
        const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
        const grandTotal = totalUSD + totalLRD;
        for (const [category, amount] of sortedCategories) {
            const percentage = ((amount / grandTotal) * 100).toFixed(1);
            const currency = category.includes('LRD') ? 'LRD' : 'USD';
            categoryHtml += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span>${category}</span>
                    <span><strong>${formatCurrency(amount, currency)}</strong> (${percentage}%)</span>
                </div>
                <div class="progress mb-2" style="height: 6px; background: rgba(255,255,255,0.1);">
                    <div class="progress-bar" style="width: ${percentage}%; background: linear-gradient(90deg, #002868, #BF0A30);"></div>
                </div>
            `;
        }
        
        // Build employee breakdown
        let employeeHtml = '';
        for (const [name, amount] of Object.entries(employeeTotals)) {
            const percentage = ((amount / grandTotal) * 100).toFixed(1);
            employeeHtml += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span>${name}</span>
                    <span><strong>${formatCurrency(amount, 'USD')}</strong> (${percentage}%)</span>
                </div>
            `;
        }
        
        // Get report title
        const reportTitles = {
            daily: 'Daily Expense Report',
            weekly: 'Weekly Expense Report',
            monthly: 'Monthly Expense Report'
        };
        
        const dateLabels = {
            daily: `Today (${startDate})`,
            weekly: `Week of ${startDate} to ${endDate}`,
            monthly: `Month of ${startDate} to ${endDate}`
        };
        
        Swal.fire({
            title: reportTitles[type] || 'Expense Report',
            html: `
                <div class="text-start">
                    <div class="mb-3 p-2" style="background: rgba(0,40,104,0.1); border-radius: 8px;">
                        <p class="mb-1"><strong>📅 Period:</strong> ${dateLabels[type] || startDate + ' to ' + endDate}</p>
                        <div class="row">
                            <div class="col-6">
                                <p class="mb-1"><strong>🇺🇸 USD Total:</strong> <span style="font-size: 1.2rem; font-weight: 700; color: #4caf50;">${formatCurrency(totalUSD, 'USD')}</span></p>
                                <p class="mb-1"><small>Pending: ${formatCurrency(pendingUSD, 'USD')}</small></p>
                                <p class="mb-1"><small>Approved: ${formatCurrency(approvedUSD, 'USD')}</small></p>
                            </div>
                            <div class="col-6">
                                <p class="mb-1"><strong>🇱🇷 LRD Total:</strong> <span style="font-size: 1.2rem; font-weight: 700; color: #ff9800;">${formatCurrency(totalLRD, 'LRD')}</span></p>
                                <p class="mb-1"><small>Pending: ${formatCurrency(pendingLRD, 'LRD')}</small></p>
                                <p class="mb-1"><small>Approved: ${formatCurrency(approvedLRD, 'LRD')}</small></p>
                            </div>
                        </div>
                        <div class="d-flex gap-3 mt-2">
                            <span><span class="badge bg-secondary">📝 Total Entries:</span> ${snapshot.size}</span>
                        </div>
                    </div>
                    
                    <div class="row">
                        <div class="col-md-6">
                            <h6><i class="fas fa-tags"></i> By Category</h6>
                            ${categoryHtml}
                        </div>
                        <div class="col-md-6">
                            <h6><i class="fas fa-users"></i> By Employee</h6>
                            ${employeeHtml}
                        </div>
                    </div>
                </div>
            `,
            icon: 'info',
            confirmButtonColor: '#fff',
            width: 700,
            showCloseButton: true,
            showDenyButton: true,
            denyButtonText: '📥 Export as CSV',
            denyButtonColor: '#4caf50'
        }).then((result) => {
            if (result.isDenied) {
                exportExpenseReportCSV(snapshot, type, startDate, endDate);
            }
        });
        
    } catch (error) {
        console.error('Error generating report:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to generate report: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
};

// ========== EXPORT EXPENSE REPORT AS CSV ==========
function exportExpenseReportCSV(snapshot, type, startDate, endDate) {
    try {
        let csv = 'Date,Employee,Category,Currency,Amount,Status,Description\n';
        let totalUSD = 0;
        let totalLRD = 0;
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const currency = data.currency || 'USD';
            csv += `${data.date},${data.employeeName},${data.category},${currency},${data.amount},${data.status},"${(data.description || '').replace(/"/g, '""')}"\n`;
            if (currency === 'USD') totalUSD += parseFloat(data.amount) || 0;
            else totalLRD += parseFloat(data.amount) || 0;
        });
        
        csv += `\nTotal USD,,,USD,${totalUSD.toFixed(2)},,\n`;
        csv += `Total LRD,,,LRD,${totalLRD.toFixed(2)},,\n`;
        csv += `Grand Total,,,USD,${(totalUSD + totalLRD).toFixed(2)},,\n`;
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `expense_report_${type}_${startDate}_to_${endDate}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        Swal.fire({
            title: '✅ Exported!',
            text: 'CSV file downloaded successfully.',
            icon: 'success',
            confirmButtonColor: '#fff'
        });
    } catch (error) {
        console.error('Error exporting CSV:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to export CSV: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
}

// ========== EXPENSE SUMMARY ==========
window.showExpenseSummary = async function() {
    try {
        const snapshot = await getDocs(collection(db, 'expenses'));
        if (snapshot.empty) {
            Swal.fire({
                title: 'No Expenses',
                text: 'No expenses recorded yet.',
                icon: 'info',
                confirmButtonColor: '#fff'
            });
            return;
        }
        
        let totalUSD = 0;
        let totalLRD = 0;
        let pendingUSD = 0;
        let pendingLRD = 0;
        let approvedUSD = 0;
        let approvedLRD = 0;
        let rejectedUSD = 0;
        let rejectedLRD = 0;
        const categoryData = {};
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const amount = parseFloat(data.amount) || 0;
            const currency = data.currency || 'USD';
            
            if (currency === 'USD') {
                totalUSD += amount;
                if (data.status === 'pending') pendingUSD += amount;
                if (data.status === 'approved') approvedUSD += amount;
                if (data.status === 'rejected') rejectedUSD += amount;
            } else {
                totalLRD += amount;
                if (data.status === 'pending') pendingLRD += amount;
                if (data.status === 'approved') approvedLRD += amount;
                if (data.status === 'rejected') rejectedLRD += amount;
            }
            
            const key = `${data.category} (${currency})`;
            if (!categoryData[key]) categoryData[key] = 0;
            categoryData[key] += amount;
        });
        
        // Sort categories by amount
        const sortedCategories = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);
        let topCategories = sortedCategories.slice(0, 5).map(([cat, amt]) => {
            const currency = cat.includes('LRD') ? 'LRD' : 'USD';
            return `<li class="mb-1">${cat}: <strong>${formatCurrency(amt, currency)}</strong></li>`;
        }).join('');
        
        Swal.fire({
            title: '📊 Expense Summary',
            html: `
                <div class="text-start">
                    <div class="row g-2 mb-3">
                        <div class="col-6">
                            <div class="p-2" style="background: rgba(76,175,80,0.1); border-radius: 8px; text-align: center;">
                                <div style="font-size: 1.6rem; font-weight: 700; color: #4caf50;">${formatCurrency(totalUSD, 'USD')}</div>
                                <small>🇺🇸 USD Total</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="p-2" style="background: rgba(255,152,0,0.1); border-radius: 8px; text-align: center;">
                                <div style="font-size: 1.6rem; font-weight: 700; color: #ff9800;">${formatCurrency(totalLRD, 'LRD')}</div>
                                <small>🇱🇷 LRD Total</small>
                            </div>
                        </div>
                    </div>
                    <div class="row g-2 mb-3">
                        <div class="col-4">
                            <div class="p-2" style="background: rgba(255,152,0,0.1); border-radius: 8px; text-align: center;">
                                <div style="font-size: 1rem; font-weight: 700; color: #ff9800;">${formatCurrency(pendingUSD + pendingLRD, 'USD')}</div>
                                <small>⏳ Pending</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="p-2" style="background: rgba(76,175,80,0.1); border-radius: 8px; text-align: center;">
                                <div style="font-size: 1rem; font-weight: 700; color: #4caf50;">${formatCurrency(approvedUSD + approvedLRD, 'USD')}</div>
                                <small>✅ Approved</small>
                            </div>
                        </div>
                        <div class="col-4">
                            <div class="p-2" style="background: rgba(244,67,54,0.1); border-radius: 8px; text-align: center;">
                                <div style="font-size: 1rem; font-weight: 700; color: #f44336;">${formatCurrency(rejectedUSD + rejectedLRD, 'USD')}</div>
                                <small>❌ Rejected</small>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h6><i class="fas fa-trophy"></i> Top 5 Expense Categories</h6>
                        <ul class="list-unstyled">${topCategories || '<li>No categories yet</li>'}</ul>
                    </div>
                    <div class="mt-2">
                        <small class="text-muted">Total Entries: ${snapshot.size}</small>
                    </div>
                </div>
            `,
            icon: 'info',
            confirmButtonColor: '#fff',
            width: 500
        });
    } catch (error) {
        console.error('Error loading summary:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to load summary: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
};

// ========== EXPENSE: CONFIRM (Approve) ==========
window.confirmExpense = async function(expenseId) {
    const result = await Swal.fire({
        title: 'Approve Expense',
        text: 'Are you sure you want to approve this expense? This will change the status to "approved".',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4caf50',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, Approve',
        cancelButtonText: 'Cancel'
    });
    
    if (result.isConfirmed) {
        try {
            await updateDoc(doc(db, 'expenses', expenseId), {
                status: 'approved',
                approvedAt: Timestamp.now(),
                approvedBy: currentEmployee.id,
                approvedByName: currentEmployee.fullName
            });
            
            Swal.fire({
                title: '✅ Approved!',
                text: 'Expense has been approved successfully.',
                icon: 'success',
                confirmButtonColor: '#fff'
            });
            
            await loadExpenses();
            await loadDashboardData();
        } catch (error) {
            console.error('Error approving expense:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to approve expense: ' + error.message,
                icon: 'error',
                confirmButtonColor: '#fff'
            });
        }
    }
};

// ========== EXPENSE: DELETE ==========
window.deleteExpense = async function(expenseId) {
    const result = await Swal.fire({
        title: 'Delete Expense',
        text: 'Are you sure you want to delete this expense? This action cannot be undone.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, Delete',
        cancelButtonText: 'Cancel'
    });
    
    if (result.isConfirmed) {
        try {
            await deleteDoc(doc(db, 'expenses', expenseId));
            
            Swal.fire({
                title: '🗑️ Deleted!',
                text: 'Expense has been deleted successfully.',
                icon: 'success',
                confirmButtonColor: '#fff'
            });
            
            await loadExpenses();
            await loadDashboardData();
        } catch (error) {
            console.error('Error deleting expense:', error);
            Swal.fire({
                title: 'Error',
                text: 'Failed to delete expense: ' + error.message,
                icon: 'error',
                confirmButtonColor: '#fff'
            });
        }
    }
};

// ========== EXPENSE: EDIT ==========
window.showEditExpenseModal = async function(expenseId) {
    try {
        const expenseDoc = await getDoc(doc(db, 'expenses', expenseId));
        if (!expenseDoc.exists()) {
            Swal.fire({ title: 'Error', text: 'Expense not found', icon: 'error' });
            return;
        }
        
        const expense = expenseDoc.data();
        
        if (expense.status !== 'pending') {
            Swal.fire({
                title: 'Cannot Edit',
                text: 'Only pending expenses can be edited.',
                icon: 'warning',
                confirmButtonColor: '#fff'
            });
            return;
        }
        
        if (expense.employeeId !== currentEmployee.id) {
            Swal.fire({
                title: 'Cannot Edit',
                text: 'You can only edit your own expenses.',
                icon: 'warning',
                confirmButtonColor: '#fff'
            });
            return;
        }
        
        Swal.fire({
            title: 'Edit Expense',
            html: `
                <div class="text-start">
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">Category</label>
                        <select id="editExpenseCategory" class="swal2-input">
                            <option value="Transportation" ${expense.category === 'Transportation' ? 'selected' : ''}>Transportation</option>
                            <option value="Meals" ${expense.category === 'Meals' ? 'selected' : ''}>Meals</option>
                            <option value="Office Supplies" ${expense.category === 'Office Supplies' ? 'selected' : ''}>Office Supplies</option>
                            <option value="Software/Tools" ${expense.category === 'Software/Tools' ? 'selected' : ''}>Software/Tools</option>
                            <option value="Training" ${expense.category === 'Training' ? 'selected' : ''}>Training</option>
                            <option value="Utilities" ${expense.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
                            <option value="Rent" ${expense.category === 'Rent' ? 'selected' : ''}>Rent</option>
                            <option value="Other" ${expense.category === 'Other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">Currency</label>
                        <select id="editExpenseCurrency" class="swal2-input">
                            <option value="USD" ${expense.currency === 'USD' ? 'selected' : ''}>🇺🇸 USD - US Dollar</option>
                            <option value="LRD" ${expense.currency === 'LRD' ? 'selected' : ''}>🇱🇷 LRD - Liberian Dollar</option>
                        </select>
                    </div>
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">Amount</label>
                        <input type="number" id="editExpenseAmount" class="swal2-input" step="0.01" value="${expense.amount}">
                    </div>
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">Date</label>
                        <input type="date" id="editExpenseDate" class="swal2-input" value="${expense.date}">
                    </div>
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">Description</label>
                        <textarea id="editExpenseDescription" class="swal2-textarea" rows="3">${expense.description || ''}</textarea>
                    </div>
                    <div class="mb-2">
                        <label style="color: #666; font-weight: 600;">New Receipt (optional)</label>
                        <input type="file" id="editReceiptImage" class="swal2-file" accept="image/*">
                    </div>
                    ${expense.receiptUrl ? `<div class="mb-2"><small>Current receipt uploaded</small></div>` : ''}
                </div>
            `,
            confirmButtonText: 'Save Changes',
            showCancelButton: true,
            confirmButtonColor: '#4caf50',
            cancelButtonColor: '#d33',
            preConfirm: async () => {
                const category = Swal.getPopup().querySelector('#editExpenseCategory').value;
                const currency = Swal.getPopup().querySelector('#editExpenseCurrency').value;
                const amount = parseFloat(Swal.getPopup().querySelector('#editExpenseAmount').value);
                const date = Swal.getPopup().querySelector('#editExpenseDate').value;
                const description = Swal.getPopup().querySelector('#editExpenseDescription').value;
                const receiptFile = Swal.getPopup().querySelector('#editReceiptImage').files[0];
                
                if (!amount || amount <= 0) {
                    Swal.showValidationMessage('Please enter a valid amount');
                    return false;
                }
                if (!date) {
                    Swal.showValidationMessage('Please select a date');
                    return false;
                }
                
                let receiptUrl = expense.receiptUrl || '';
                if (receiptFile) {
                    const storageRef = ref(storage, `receipts/${currentEmployee.id}/${Date.now()}_${receiptFile.name}`);
                    await uploadBytes(storageRef, receiptFile);
                    receiptUrl = await getDownloadURL(storageRef);
                }
                
                await updateDoc(doc(db, 'expenses', expenseId), {
                    category: category,
                    currency: currency,
                    amount: amount,
                    date: date,
                    description: description,
                    receiptUrl: receiptUrl,
                    updatedAt: Timestamp.now()
                });
                
                return true;
            }
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire({
                    title: '✅ Updated!',
                    text: 'Expense has been updated successfully.',
                    icon: 'success',
                    confirmButtonColor: '#fff'
                });
                loadExpenses();
                loadDashboardData();
            }
        });
    } catch (error) {
        console.error('Error loading expense for edit:', error);
        Swal.fire({
            title: 'Error',
            text: 'Failed to load expense for editing: ' + error.message,
            icon: 'error',
            confirmButtonColor: '#fff'
        });
    }
};

// ========== DOCUMENTS ==========
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
                            <i class="fas fa-file-${fileExt === 'pdf' ? 'pdf' : 'image'} fa-2x"></i>
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

// ========== PERFORMANCE REVIEWS ==========
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

// ========== ANNOUNCEMENTS ==========
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

// ========== CREATE FUNCTIONS ==========
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
        confirmButtonColor: '#fff',
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
        Swal.fire({ title: 'Success', text: 'Task created successfully', icon: 'success', confirmButtonColor: '#fff' });
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
    
    if (!title || !dateTime) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', confirmButtonColor: '#fff' }); return; }
    
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
    Swal.fire({ title: 'Success', text: 'Appointment scheduled successfully', icon: 'success', confirmButtonColor: '#fff' });
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
    
    if (!startDate || !endDate) { Swal.fire({ title: 'Error', text: 'Please select dates', icon: 'error', confirmButtonColor: '#fff' }); return; }
    
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
    Swal.fire({ title: 'Success', text: 'Leave request submitted successfully', icon: 'success', confirmButtonColor: '#fff' });
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
    const currency = document.getElementById('expenseCurrency').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const date = document.getElementById('expenseDate').value;
    const description = document.getElementById('expenseDescription').value;
    const receiptFile = document.getElementById('receiptImage').files[0];
    
    if (!category || !amount || !date) { Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', confirmButtonColor: '#fff' }); return; }
    
    let receiptUrl = '';
    if (receiptFile) {
        const storageRef = ref(storage, `receipts/${currentEmployee.id}/${Date.now()}_${receiptFile.name}`);
        await uploadBytes(storageRef, receiptFile);
        receiptUrl = await getDownloadURL(storageRef);
    }
    
    await addDoc(collection(db, 'expenses'), {
        category: category,
        currency: currency,
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
    Swal.fire({ title: 'Success', text: 'Expense submitted successfully', icon: 'success', confirmButtonColor: '#fff' });
    await loadExpenses();
    await loadDashboardData();
};

window.updateTaskStatus = async function(taskId, status) {
    await updateDoc(doc(db, 'tasks', taskId), { status: status, completedAt: status === 'completed' ? Timestamp.now() : null });
    Swal.fire({ title: 'Success', text: 'Task updated', icon: 'success', confirmButtonColor: '#fff' });
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
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
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
        confirmButtonColor: '#fff',
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

async function markMessageAsRead(messageId) {
    if (!currentEmployee?.id) return;
    try {
        const messageRef = doc(db, 'chat_messages', messageId);
        await updateDoc(messageRef, {
            readBy: arrayUnion(currentEmployee.id)
        });
    } catch (error) {
        console.error('Error marking message as read:', error);
    }
}

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
        for (const docSnapshot of snapshot.docs) {
            const msg = docSnapshot.data();
            if (type === 'dm') {
                if (msg.senderId === userId || msg.receiverId === userId || 
                    (msg.senderId === currentEmployee.id && msg.receiverId === userId) ||
                    (msg.senderId === userId && msg.receiverId === currentEmployee.id)) {
                    messages.push({ id: docSnapshot.id, ...msg });
                }
            } else {
                messages.push({ id: docSnapshot.id, ...msg });
            }
        }
        messages.sort((a, b) => (a.timestamp?.toDate() || 0) - (b.timestamp?.toDate() || 0));
        
        for (const msg of messages) {
            if (msg.senderId !== currentEmployee.id && (!msg.readBy || !msg.readBy.includes(currentEmployee.id))) {
                await markMessageAsRead(msg.id);
            }
        }
        
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
        
        const readBy = msg.readBy || [];
        const readByNames = [];
        for (const readerId of readBy) {
            if (readerId !== msg.senderId) {
                const readerDoc = await getDoc(doc(db, 'employees', readerId));
                if (readerDoc.exists()) {
                    const reader = readerDoc.data();
                    readByNames.push(reader.nickname || reader.fullName);
                }
            }
        }
        
        const readReceiptsHtml = readByNames.length > 0 ? `
            <div class="chat-read-receipts">
                <small class="text-muted">Seen by: ${readByNames.slice(0, 3).join(', ')}${readByNames.length > 3 ? ` +${readByNames.length - 3}` : ''}</small>
            </div>
        ` : '';
        
        let mediaHtml = '';
        if (msg.mediaType === 'image') {
            mediaHtml = `<div class="chat-media-container mt-2">
                <img src="${msg.mediaUrl}" class="chat-image" onclick="window.open('${msg.mediaUrl}', '_blank')" style="max-width: 200px; max-height: 150px; border-radius: 10px; cursor: pointer;">
            </div>`;
        } else if (msg.mediaType === 'file') {
            mediaHtml = `<div class="chat-media-container mt-2">
                <a href="${msg.mediaUrl}" target="_blank" class="chat-file-link">
                    <i class="fas fa-file-download"></i> ${msg.fileName || 'Download File'} (${msg.fileSize ? (msg.fileSize / 1024).toFixed(1) + ' KB' : ''})
                </a>
            </div>`;
        }
        
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
                <div class="chat-message-name">${escapeHtml(displayName)}</div>
                <div class="chat-message-text">${escapeHtml(msg.message || '')}</div>
                ${mediaHtml}
                <div class="chat-message-time">${msg.timestamp?.toDate().toLocaleTimeString()}</div>
                ${readReceiptsHtml}
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
        type: currentChatType,
        readBy: [currentEmployee.id]
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
    Swal.fire({ title: 'Success', text: 'Profile updated!', icon: 'success', confirmButtonColor: '#fff' });
    
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

// ========== ADMIN FUNCTIONS ==========
window.showAdminEmployees = function() {
    loadEmployeesTable();
    document.getElementById('adminContent').innerHTML = `
        <div class="glass-card-inner">
            <div class="card-header-glass">Employee Management</div>
            <div class="table-responsive">
                <table class="glass-table">
                    <thead><tr><th>Name</th><th>DSSN</th><th>Department</th><th>Position</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody id="employeesTableBody"></tbody>
                </table>
            </div>
            <button class="btn-glass-primary m-3" onclick="showAddEmployeeModal()"><i class="fas fa-plus"></i> Add Employee</button>
        </div>
    `;
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
        Swal.fire({ title: 'Error', text: 'Please fill all fields', icon: 'error' });
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
    
    Swal.fire({ title: 'Success', text: 'Announcement posted', icon: 'success', confirmButtonColor: '#fff' });
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

window.showAddEmployeeModal = function() {
    document.getElementById('empName').value = '';
    document.getElementById('empEmail').value = '';
    document.getElementById('empDSSN').value = '';
    document.getElementById('empDepartment').value = 'Engineering';
    document.getElementById('empPosition').value = '';
    document.getElementById('empPhone').value = '';
    document.getElementById('empSalary').value = '';
    document.getElementById('empRole').value = 'employee';
    
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
    
    if (!fullName || !email || !dssn) {
        Swal.fire({ title: 'Error', text: 'Please fill required fields', icon: 'error', confirmButtonColor: '#fff' });
        return;
    }
    
    const q = query(collection(db, 'employees'), where('dssn', '==', dssn));
    const existing = await getDocs(q);
    if (!existing.empty) {
        Swal.fire({ title: 'Error', text: 'DSSN already exists!', icon: 'error', confirmButtonColor: '#fff' });
        return;
    }
    
    await addDoc(collection(db, 'employees'), {
        fullName: fullName,
        email: email,
        dssn: dssn,
        department: department,
        position: position,
        phone: phone,
        salary: salary || 0,
        role: role,
        annualLeave: 20,
        sickLeave: 10,
        status: 'active',
        createdAt: Timestamp.now()
    });
    
    bootstrap.Modal.getInstance(document.getElementById('employeeModal')).hide();
    Swal.fire({ title: 'Success', text: 'Employee added!', icon: 'success', confirmButtonColor: '#fff' });
    await loadEmployeesTable();
};

window.deleteEmployee = async function(employeeId) {
    const result = await Swal.fire({
        title: 'Confirm Delete',
        text: 'Are you sure?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete'
    });
    
    if (result.isConfirmed) {
        await deleteDoc(doc(db, 'employees', employeeId));
        Swal.fire({ title: 'Deleted', text: 'Employee deleted', icon: 'success', confirmButtonColor: '#fff' });
        await loadEmployeesTable();
    }
};

window.generateReport = async function() {
    const startDate = document.getElementById('reportStart').value;
    const endDate = document.getElementById('reportEnd').value;
    
    if (!startDate || !endDate) {
        Swal.fire({ title: 'Error', text: 'Please select date range', icon: 'error' });
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
        Swal.fire({ title: 'Error', text: 'Please select month', icon: 'error' });
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

// ========== SHOW SECTION ==========
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
