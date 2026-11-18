import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth';
import { Firestore, doc, getDocFromServer, getFirestore } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface FirebaseConfigShape {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
}

// Safely detect firebase-applet-config.json if provisioned by AI Studio without breaking Vite builds when absent
const configModules = import.meta.glob('../../firebase-applet-config.json', {
  eager: true,
}) as Record<string, { default?: FirebaseConfigShape }>;

export function getProvisionedFirebaseConfig(): FirebaseConfigShape | null {
  const firstKey = Object.keys(configModules)[0];
  if (firstKey && configModules[firstKey]?.default?.apiKey) {
    return configModules[firstKey].default!;
  }
  try {
    const raw = localStorage.getItem('bula_ppa_firebase_config');
    if (raw) {
      const parsed = JSON.parse(raw) as FirebaseConfigShape;
      if (parsed && parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    }
  } catch {
    // ignore invalid local config
  }
  return null;
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function initFirebaseServices(customConfig?: FirebaseConfigShape | null): {
  configured: boolean;
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  projectId: string | null;
} {
  const cfg = customConfig ?? getProvisionedFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId || cfg.projectId === 'remixed-project-id') {
    return { configured: false, app: null, auth: null, db: null, projectId: null };
  }

  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApps()[0] : initializeApp(cfg);
    cachedAuth = getAuth(cachedApp);
    cachedDb = cfg.firestoreDatabaseId
      ? getFirestore(cachedApp, cfg.firestoreDatabaseId)
      : getFirestore(cachedApp);
  }

  return {
    configured: true,
    app: cachedApp,
    auth: cachedAuth,
    db: cachedDb,
    projectId: cfg.projectId,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
  authInstance?: Auth | null
): never {
  const currentUser = authInstance?.currentUser ?? cachedAuth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(db: Firestore): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    // Missing test/connection document is expected and still proves online reachability
    return true;
  }
}

export async function signInWithGoogleFirebase(auth: Auth) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function signOutFirebase(auth: Auth) {
  return signOut(auth);
}
