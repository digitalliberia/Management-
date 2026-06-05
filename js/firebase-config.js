import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, doc, Timestamp, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Firebase configuration for HR Management System
const firebaseConfig = {
    apiKey: "AIzaSyCrtORDMSIkydaVxSRD51ZHhns7Tkm_A9s",
    authDomain: "management-dl.firebaseapp.com",
    projectId: "management-dl",
    storageBucket: "management-dl.firebasestorage.app",
    messagingSenderId: "956539945429",
    appId: "1:956539945429:web:7d747bf40c6754562b3d5c"
};

// Initialize Firebase
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

// Export additional auth methods for convenience
export { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut };window.ref = ref;
window.uploadBytes = uploadBytes;
window.getDownloadURL = getDownloadURL;
window.signOut = signOut;
