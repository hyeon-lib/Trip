import React, { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "./firebase";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // 로그인 / 회원가입
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [message, setMessage] = useState("");

  // 여행
  const [tripName, setTripName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [trips, setTrips] = useState([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        await loadTrips(currentUser.uid);
      } else {
        setTrips([]);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 랜덤 초대 코드 만들기
  const makeInviteCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";

    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  };

  // 내가 들어가 있는 여행 불러오기
  const loadTrips = async (uid) => {
    try {
      const tripsRef = collection(db, "trips");

      const q = query(
        tripsRef,
        where("memberIds", "array-contains", uid)
      );

      const snapshot = await getDocs(q);

      const tripList = snapshot.docs.map((tripDoc) => ({
        id: tripDoc.id,
        ...tripDoc.data(),
      }));

      setTrips(tripList);
    } catch (error) {
      console.error("여행 불러오기 오류:", error);
    }
  };

  // 회원가입
  const handleSignup = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!email.trim() || !password.trim()) {
      setMessage("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    if (password.length < 6) {
      setMessage("비밀번호는 6자리 이상이어야 합니다.");
      return;
    }

    try {
      await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      setMessage("회원가입이 완료되었습니다.");
    } catch (error) {
      console.error(error);

      if (error.code === "auth/email-already-in-use") {
        setMessage("이미 가입된 이메일입니다.");
      } else if (error.code === "auth/invalid-email") {
        setMessage("올바른 이메일 주소를 입력해주세요.");
      } else if (error.code === "auth/weak-password") {
        setMessage("비밀번호가 너무 짧습니다.");
      } else {
        setMessage(`회원가입 오류: ${error.message}`);
      }
    }
  };

  // 로그인
  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");

    if (!email.trim() || !password.trim()) {
      setMessage("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    try {
      await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

      setMessage("");
    } catch (error) {
      console.error(error);

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        setMessage("이메일 또는 비밀번호가 올바르지 않습니다.");
      } else {
        setMessage(`로그인 오류: ${error.message}`);
      }
    }
  };

  // 로그아웃
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
    }
  };

  // 새 여행 만들기
  const handleCreateTrip = async () => {
    if (!user) {
      setMessage("로그인이 필요합니다.");
      return;
    }

    if (!tripName.trim()) {
      setMessage("여행 이름을 입력해주세요.");
      return;
    }

    try {
      let code = makeInviteCode();

      // 혹시 같은 초대 코드가 있으면 다시 생성
      let codeExists = true;

      while (codeExists) {
        const q = query(
          collection(db, "trips"),
          where("inviteCode", "==", code)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
          codeExists = false;
        } else {
          code = makeInviteCode();
        }
      }

      await addDoc(collection(db, "trips"), {
        name: tripName.trim(),
        ownerId: user.uid,
        ownerEmail: user.email,
        inviteCode: code,
        memberIds: [user.uid],
        memberEmails: [user.email],
        createdAt: serverTimestamp(),
      });

      setTripName("");
      setMessage(`여행이 만들어졌습니다. 초대코드: ${code}`);

      await loadTrips(user.uid);
    } catch (error) {
      console.error("여행 생성 오류:", error);
      setMessage(`여행 생성 오류: ${error.message}`);
    }
  };

  // 초대코드로 여행 참가
  const handleJoinTrip = async () => {
    if (!user) {
      setMessage("로그인이 필요합니다.");
      return;
    }

    const code = inviteCode.trim().toUpperCase();

    if (!code) {
      setMessage("초대코드를 입력해주세요.");
      return;
    }

    try {
      const q = query(
        collection(db, "trips"),
        where("inviteCode", "==", code)
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setMessage("존재하지 않는 초대코드입니다.");
        return;
      }

      const tripDocument = snapshot.docs[0];
      const tripData = tripDocument.data();

      if (tripData.memberIds?.includes(user.uid)) {
        setMessage("이미 참여 중인 여행입니다.");
        return;
      }

      await updateDoc(doc(db, "trips", tripDocument.id), {
        memberIds: arrayUnion(user.uid),
        memberEmails: arrayUnion(user.email),
      });

      setInviteCode("");
      setMessage(`"${tripData.name}" 여행에 참여했습니다.`);

      await loadTrips(user.uid);
    } catch (error) {
      console.error("여행 참가 오류:", error);
      setMessage(`여행 참가 오류: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div style={styles.center}>
        <h2>불러오는 중...</h2>
      </div>
    );
  }

  // 로그인 전 화면
  if (!user) {
    return (
      <div style={styles.page}>
        <div style={styles.authCard}>
          <div style={styles.logo}>✈️</div>

          <h1 style={styles.title}>우리의 여행</h1>

          <p style={styles.subtitle}>
            함께 만드는 여행 계획
          </p>

          <form
            onSubmit={
              authMode === "login"
                ? handleLogin
                : handleSignup
            }
          >
            <input
              style={styles.input}
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            <input
              style={styles.input}
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                authMode === "login"
                  ? "current-password"
                  : "new-password"
              }
            />

            <button
              style={styles.mainButton}
              type="submit"
            >
              {authMode === "login"
                ? "로그인"
                : "회원가입"}
            </button>
          </form>

          <button
            style={styles.textButton}
            type="button"
            onClick={() => {
              setMessage("");
              setAuthMode(
                authMode === "login"
                  ? "signup"
                  : "login"
              );
            }}
          >
            {authMode === "login"
              ? "처음이신가요? 회원가입"
              : "이미 계정이 있나요? 로그인"}
          </button>

          {message && (
            <div style={styles.message}>
              {message}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 로그인 후 화면
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.smallText}>
              반가워요 👋
            </div>

            <h1 style={styles.headerTitle}>
              우리의 여행
            </h1>
          </div>

          <button
            style={styles.logoutButton}
            onClick={handleLogout}
          >
            로그아웃
          </button>
        </header>

        <div style={styles.userBox}>
          {user.email}
        </div>

        {message && (
          <div style={styles.message}>
            {message}
          </div>
        )}

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            새 여행 만들기
          </h2>

          <p style={styles.description}>
            여행을 만들면 친구에게 알려줄
            초대코드가 자동으로 생성됩니다.
          </p>

          <input
            style={styles.input}
            placeholder="예: 2026 도쿄 여행"
            value={tripName}
            onChange={(e) =>
              setTripName(e.target.value)
            }
          />

          <button
            style={styles.mainButton}
            onClick={handleCreateTrip}
          >
            여행 만들기
          </button>
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>
            초대코드로 참여하기
          </h2>

          <p style={styles.description}>
            여행 주인에게 받은 6자리 코드를
            입력해주세요.
          </p>

          <input
            style={{
              ...styles.input,
              textTransform: "uppercase",
              letterSpacing: "4px",
              fontWeight: "bold",
              textAlign: "center",
            }}
            maxLength={6}
            placeholder="ABC123"
            value={inviteCode}
            onChange={(e) =>
              setInviteCode(
                e.target.value.toUpperCase()
              )
            }
          />

          <button
            style={styles.secondaryButton}
            onClick={handleJoinTrip}
          >
            여행 참여하기
          </button>
        </section>

        <section>
          <h2 style={styles.sectionTitle}>
            내 여행
          </h2>

          {trips.length === 0 ? (
            <div style={styles.empty}>
              아직 참여 중인 여행이 없습니다.
              <br />
              새 여행을 만들거나 초대코드를
              입력해보세요.
            </div>
          ) : (
            trips.map((trip) => (
              <div
                style={styles.tripCard}
                key={trip.id}
              >
                <div>
                  <div style={styles.tripName}>
                    {trip.name}
                  </div>

                  <div style={styles.tripInfo}>
                    {trip.ownerId === user.uid
                      ? "내가 만든 여행"
                      : "초대받은 여행"}
                  </div>
                </div>

                {trip.ownerId === user.uid && (
                  <div style={styles.codeBox}>
                    <span style={styles.codeLabel}>
                      초대코드
                    </span>

                    <strong>
                      {trip.inviteCode}
                    </strong>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f8f5ef",
    fontFamily:
      "'Pretendard', 'Noto Sans KR', sans-serif",
    color: "#3f3a35",
  },

  center: {
    minHeight: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f8f5ef",
  },

  container: {
    width: "min(92%, 620px)",
    margin: "0 auto",
    padding: "30px 0 70px",
  },

  authCard: {
    width: "min(85%, 400px)",
    margin: "0 auto",
    paddingTop: "100px",
    textAlign: "center",
  },

  logo: {
    fontSize: "52px",
    marginBottom: "16px",
  },

  title: {
    margin: "0",
    fontSize: "30px",
    letterSpacing: "-1px",
  },

  subtitle: {
    margin: "10px 0 35px",
    color: "#8a8178",
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "16px 18px",
    marginBottom: "12px",
    borderRadius: "16px",
    border: "1px solid #e4ddd3",
    background: "#fff",
    fontSize: "16px",
    outline: "none",
  },

  mainButton: {
    width: "100%",
    padding: "16px",
    border: "none",
    borderRadius: "16px",
    background: "#5f8068",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "700",
    cursor: "pointer",
  },

  secondaryButton: {
    width: "100%",
    padding: "16px",
    border: "none",
    borderRadius: "16px",
    background: "#d9a36c",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "700",
    cursor: "pointer",
  },

  textButton: {
    marginTop: "18px",
    border: "none",
    background: "transparent",
    color: "#6f796e",
    cursor: "pointer",
    fontSize: "14px",
  },

  message: {
    marginTop: "18px",
    padding: "14px",
    borderRadius: "14px",
    background: "#fff4df",
    color: "#7b5b32",
    fontSize: "14px",
    lineHeight: "1.5",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },

  smallText: {
    color: "#9a9187",
    fontSize: "14px",
  },

  headerTitle: {
    margin: "3px 0 0",
    fontSize: "29px",
  },

  logoutButton: {
    padding: "9px 13px",
    borderRadius: "12px",
    border: "1px solid #ded7ce",
    background: "#fff",
    color: "#6c655e",
    cursor: "pointer",
  },

  userBox: {
    fontSize: "13px",
    color: "#898078",
    marginBottom: "24px",
  },

  card: {
    padding: "24px",
    marginBottom: "18px",
    background: "#fff",
    borderRadius: "24px",
    boxShadow:
      "0 8px 30px rgba(95, 80, 60, 0.06)",
  },

  cardTitle: {
    margin: "0 0 8px",
    fontSize: "19px",
  },

  description: {
    margin: "0 0 18px",
    color: "#8c837a",
    fontSize: "14px",
    lineHeight: "1.6",
  },

  sectionTitle: {
    margin: "32px 0 15px",
    fontSize: "21px",
  },

  tripCard: {
    padding: "20px",
    marginBottom: "12px",
    borderRadius: "20px",
    background: "#fff",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    boxShadow:
      "0 5px 24px rgba(95, 80, 60, 0.05)",
  },

  tripName: {
    fontSize: "17px",
    fontWeight: "700",
  },

  tripInfo: {
    marginTop: "5px",
    color: "#918880",
    fontSize: "13px",
  },

  codeBox: {
    display: "flex",
    flexDirection: "column",
    textAlign: "right",
    padding: "8px 12px",
    borderRadius: "12px",
    background: "#f3eee6",
    letterSpacing: "1px",
  },

  codeLabel: {
    marginBottom: "3px",
    fontSize: "10px",
    color: "#988c80",
    letterSpacing: "0",
  },

  empty: {
    padding: "35px 20px",
    borderRadius: "20px",
    background: "#efeae2",
    textAlign: "center",
    color: "#8b837a",
    lineHeight: "1.7",
    fontSize: "14px",
  },
};

export default App;
