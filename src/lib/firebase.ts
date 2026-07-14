import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
});

// Initialize Firestore with custom database ID if provided
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

/**
 * Saves KML text to Firestore database
 * @param kmlText KML file contents
 * @param userEmail Email of the user performing the save
 */
export async function saveKmlToFirestore(kmlText: string, userEmail: string): Promise<void> {
  const docRef = doc(db, "kml_data", "current");
  await setDoc(docRef, {
    kmlText,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail,
  });
}

/**
 * Retrieves KML text from Firestore database
 * @returns KML text or null if not found
 */
export async function getKmlFromFirestore(): Promise<string | null> {
  try {
    const docRef = doc(db, "kml_data", "current");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data().kmlText || null;
    }
    return null;
  } catch (error) {
    console.error("Error reading KML from Firestore:", error);
    return null;
  }
}
