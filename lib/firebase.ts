import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBKPzlo37UAsE38dZZquBxPjnx6vSWFtbA",
  authDomain: "masjid-baitul-fadli.firebaseapp.com",
  projectId: "masjid-baitul-fadli",
  storageBucket: "masjid-baitul-fadli.firebasestorage.app",
  messagingSenderId: "423043019841",
  appId: "1:423043019841:web:448fa1b2a7b35a9ef742c0",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export function getSecondaryAuth() {
  const secondary = getApps().find((item) => item.name === "Secondary") ?? initializeApp(firebaseConfig, "Secondary");
  return getAuth(secondary);
}
