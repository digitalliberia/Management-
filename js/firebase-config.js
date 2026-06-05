import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, doc, Timestamp, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Create a NEW Firebase project for HR system - REPLACE WITH YOUR HR PROJECT CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyBBdSHo-itRn-5A9t9v-3-dxVDNqHNNW4A",
    authDomain: "music-platform-dl.firebaseapp.com",
    projectId: "music-platform-dl",
    storageBucket: "music-platform-dl.firebasestorage.app",
    messagingSenderId: "1054189036079",
    appId: "1:1054189036079:web:235b2b4845d8df76879cda"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Global exports for use in other files
window.db = db;
window.auth = auth;
window.storage = storage;
window.Timestamp = Timestamp;
window.collection = collection;
window.addDoc = addDoc;
window.getDocs = getDocs;
window.query = query;
window.where = where;
window.updateDoc = updateDoc;
window.deleteDoc = deleteDoc;
window.doc = doc;
window.orderBy = orderBy;
window.limit = limit;
window.getDoc = getDoc;
window.ref = ref;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;
window.signOut = signOut;
