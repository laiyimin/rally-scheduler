// Firebase 網頁設定（公開資訊，不是密碼；真正的權限由 database.rules.json 控管）
// 設為 null 時 app 只在本機運作，不顯示雲端分享功能。
export const firebaseConfig = {
  apiKey: "AIzaSyA1aIrMQ5J7RNvSzkME2PWdV_LJG5zkM7I",
  authDomain: "rally-scheduler.firebaseapp.com",
  databaseURL: "https://rally-scheduler-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rally-scheduler",
  storageBucket: "rally-scheduler.firebasestorage.app",
  messagingSenderId: "527772669786",
  appId: "1:527772669786:web:b16d9433b4e5b431eec563",
};
