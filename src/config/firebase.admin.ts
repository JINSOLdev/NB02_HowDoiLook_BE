import admin from 'firebase-admin';

type FirebaseConfig = admin.ServiceAccount & {
  private_key?: string;
};

let bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']> | undefined;

export default function getFirebaseBucket() {
  if (bucket) return bucket;

  const raw = process.env.FIREBASE_CONFIG;
  if (!raw) {
    const error = new Error('FIREBASE_CONFIG is required for image uploads') as Error & { statusCode?: number };
    error.statusCode = 503;
    throw error;
  }

  let serviceAccount: FirebaseConfig;
  try {
    serviceAccount = JSON.parse(raw) as FirebaseConfig;
  } catch (error) {
    throw new Error('FIREBASE_CONFIG must contain valid JSON', { cause: error });
  }

  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'gs://nb02-how-do-i-look-storage.firebasestorage.app',
    });
  }

  bucket = admin.storage().bucket();
  return bucket;
}
