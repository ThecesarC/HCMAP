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
export async function saveKmlToFirestore(kmlText: string, userEmail: string, districtsData?: any, customTimestamp?: number): Promise<void> {
  // 1. Determine previous number of chunks to clean up excess
  let prevNumChunks = 0;
  let prevNumDistrictsChunks = 0;
  try {
    const prevDocSnap = await getDoc(doc(db, "kml_data", "current"));
    if (prevDocSnap.exists()) {
      const prevData = prevDocSnap.data();
      if (prevData.isChunked) {
        prevNumChunks = prevData.numChunks || 0;
      }
      prevNumDistrictsChunks = prevData.numDistrictsChunks || 0;
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

  // Strip kmlDoc from districtsData to prevent serialization errors before storing
  let cleanDistrictsJson = null;
  if (districtsData) {
    try {
      const sanitized = JSON.parse(JSON.stringify(districtsData, (key, value) => {
        if (key === 'kmlDoc') return undefined; // Omit parsed XML doc, regenerate on load
        return value;
      }));
      cleanDistrictsJson = JSON.stringify(sanitized);
    } catch (e) {
      console.warn("Could not serialize districtsData:", e);
    }
  }

  // 4. Save districtsJson in chunks if needed
  let numDistrictsChunks = 0;
  if (cleanDistrictsJson) {
    const distChunks: string[] = [];
    for (let i = 0; i < cleanDistrictsJson.length; i += chunkSize) {
      distChunks.push(cleanDistrictsJson.substring(i, i + chunkSize));
    }
    numDistrictsChunks = distChunks.length;
    const distPromises = distChunks.map((chunkText, i) => {
      return setDoc(doc(db, "kml_data", `districts_chunk_${i}`), {
        text: chunkText,
        chunkIndex: i,
      });
    });
    await Promise.all(distPromises);
  }

  // 5. Save metadata document with explicit millisecond timestamp
  const ts = customTimestamp || Date.now();
  const docRef = doc(db, "kml_data", "current");
  await setDoc(docRef, {
    isChunked: true,
    numChunks,
    numDistrictsChunks,
    updatedAt: new Date(ts).toISOString(),
    updatedAtMs: ts,
    updatedBy: userEmail,
    districtsJson: (cleanDistrictsJson && cleanDistrictsJson.length < 300000) ? cleanDistrictsJson : null
  });

  // 6. Clean up any excess old chunks if the new KML has fewer chunks
  const deletePromises: Promise<void>[] = [];
  if (prevNumChunks > numChunks) {
    for (let i = numChunks; i < prevNumChunks; i++) {
      deletePromises.push(deleteDoc(doc(db, "kml_data", `chunk_${i}`)));
    }
  }
  if (prevNumDistrictsChunks > numDistrictsChunks) {
    for (let i = numDistrictsChunks; i < prevNumDistrictsChunks; i++) {
      deletePromises.push(deleteDoc(doc(db, "kml_data", `districts_chunk_${i}`)));
    }
  }
  if (deletePromises.length > 0) {
    try {
      await Promise.all(deletePromises);
    } catch (delErr) {
      console.warn("Could not delete obsolete chunks:", delErr);
    }
  }
}

export interface FirestoreKmlResult {
  kmlText: string | null;
  districtsData: any | null;
  updatedAtMs?: number;
}

/**
 * Retrieves KML text and districts data from Firestore database, reconstructing it from chunks if necessary.
 */
export async function getKmlFromFirestore(): Promise<FirestoreKmlResult | null> {
  try {
    const docRef = doc(db, "kml_data", "current");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      let districtsData = null;
      let districtsJsonStr: string | null = data.districtsJson || null;
      const updatedAtMs = data.updatedAtMs || (data.updatedAt ? new Date(data.updatedAt).getTime() : 0);

      // If districtsJson was chunked, reconstruct it
      if (!districtsJsonStr && data.numDistrictsChunks) {
        const numDistChunks = data.numDistrictsChunks || 0;
        const distChunkPromises = [];
        for (let i = 0; i < numDistChunks; i++) {
          distChunkPromises.push(getDoc(doc(db, "kml_data", `districts_chunk_${i}`)));
        }
        const distChunkSnaps = await Promise.all(distChunkPromises);
        let reconstructedDist = "";
        for (let i = 0; i < numDistChunks; i++) {
          if (distChunkSnaps[i].exists()) {
            reconstructedDist += distChunkSnaps[i].data().text || "";
          }
        }
        districtsJsonStr = reconstructedDist || null;
      }

      if (districtsJsonStr) {
        try {
          districtsData = JSON.parse(districtsJsonStr);
        } catch (e) {
          console.warn("Could not parse districtsJson from Firestore:", e);
        }
      }

      let kmlText: string | null = null;
      if (data.isChunked) {
        const numChunks = data.numChunks || 0;
        const chunkPromises = [];
        for (let i = 0; i < numChunks; i++) {
          chunkPromises.push(getDoc(doc(db, "kml_data", `chunk_${i}`)));
        }
        const chunkSnaps = await Promise.all(chunkPromises);
        let reconstructed = "";
        for (let i = 0; i < numChunks; i++) {
          const chunkSnap = chunkSnaps[i];
          if (chunkSnap.exists()) {
            reconstructed += chunkSnap.data().text || "";
          }
        }
        kmlText = reconstructed || null;
      } else {
        kmlText = data.kmlText || null;
      }

      return { kmlText, districtsData, updatedAtMs };
    }
    return null;
  } catch (error) {
    console.error("Error reading KML from Firestore:", error);
    throw error;
  }
}
