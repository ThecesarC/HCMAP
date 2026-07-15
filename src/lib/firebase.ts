import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
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
 * Saves KML text to Firestore database, chunking it if it's large to prevent exceeding the 1MB limit.
 * @param kmlText KML file contents
 * @param userEmail Email of the user performing the save
 */
export async function saveKmlToFirestore(kmlText: string, userEmail: string): Promise<void> {
  // 1. Determine previous number of chunks to clean up excess
  let prevNumChunks = 0;
  try {
    const prevDocSnap = await getDoc(doc(db, "kml_data", "current"));
    if (prevDocSnap.exists()) {
      const prevData = prevDocSnap.data();
      if (prevData.isChunked) {
        prevNumChunks = prevData.numChunks || 0;
      }
    }
  } catch (err) {
    console.warn("Could not read previous metadata for cleanup:", err);
  }

  // 2. Split the KML text into chunks of 800,000 characters (~800KB)
  const chunkSize = 800000;
  const chunks: string[] = [];
  for (let i = 0; i < kmlText.length; i += chunkSize) {
    chunks.push(kmlText.substring(i, i + chunkSize));
  }
  const numChunks = chunks.length;

  // 3. Save all chunks in parallel
  const chunkPromises = chunks.map((chunkText, i) => {
    return setDoc(doc(db, "kml_data", `chunk_${i}`), {
      text: chunkText,
      chunkIndex: i,
    });
  });
  await Promise.all(chunkPromises);

  // 4. Save metadata document
  const docRef = doc(db, "kml_data", "current");
  await setDoc(docRef, {
    isChunked: true,
    numChunks,
    updatedAt: new Date().toISOString(),
    updatedBy: userEmail,
  });

  // 5. Clean up any excess old chunks if the new KML has fewer chunks
  if (prevNumChunks > numChunks) {
    const deletePromises = [];
    for (let i = numChunks; i < prevNumChunks; i++) {
      deletePromises.push(deleteDoc(doc(db, "kml_data", `chunk_${i}`)));
    }
    try {
      await Promise.all(deletePromises);
    } catch (delErr) {
      console.warn("Could not delete obsolete chunks:", delErr);
    }
  }
}

/**
 * Retrieves KML text from Firestore database, reconstructing it from chunks if necessary.
 * @returns KML text or null if not found
 */
export async function getKmlFromFirestore(): Promise<string | null> {
  try {
    const docRef = doc(db, "kml_data", "current");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.isChunked) {
        const numChunks = data.numChunks || 0;
        const chunkPromises = [];
        for (let i = 0; i < numChunks; i++) {
          chunkPromises.push(getDoc(doc(db, "kml_data", `chunk_${i}`)));
        }
        const chunkSnaps = await Promise.all(chunkPromises);
        let kmlText = "";
        for (let i = 0; i < numChunks; i++) {
          const chunkSnap = chunkSnaps[i];
          if (chunkSnap.exists()) {
            kmlText += chunkSnap.data().text || "";
          }
        }
        return kmlText || null;
      } else {
        return data.kmlText || null;
      }
    }
    return null;
  } catch (error) {
    console.error("Error reading KML from Firestore:", error);
    return null;
  }
}
