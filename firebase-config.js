// ✅ Firebase config — already connected to your project!
const firebaseConfig = {
  apiKey: "AIzaSyAPv0h239YCXgJTgQaaR710SC4YK5ms4VU",
  authDomain: "focus-room-dde6a.firebaseapp.com",
  databaseURL: "https://focus-room-dde6a-default-rtdb.firebaseio.com",
  projectId: "focus-room-dde6a",
  storageBucket: "focus-room-dde6a.firebasestorage.app",
  messagingSenderId: "608759636568",
  appId: "1:608759636568:web:cfd25cd385ee081bc4a02d",
  measurementId: "G-7LDNHLLB04"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

console.log("✅ Firebase connected to focus-room-dde6a!");
