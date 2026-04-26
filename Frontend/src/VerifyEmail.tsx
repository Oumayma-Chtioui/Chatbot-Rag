import { useEffect, useState } from "react"

export default function VerifyEmail() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")
  
  // get token from URL path
  const token = window.location.pathname.split('/verify-email/')[1]

  

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("No token found in URL")
      return
    }

    fetch(`http://localhost:8000/verify-email/${token}`)
      .then(async res => {
        const data = await res.json()
        if (res.ok) {
          setStatus("success")
          setMessage(data.message)
        } else {
          setStatus("error")
          setMessage(data.detail || "Verification failed")
        }
      })
      .catch(() => {
        setStatus("error")
        setMessage("Could not connect to server")
      })
  }, [token])

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", 
                  height:"100vh", fontFamily:"sans-serif" }}>
      {status === "loading" && <p>Verifying...</p>}
      {status === "success" && (
        <div style={{ textAlign:"center" }}>
          <h2>✓ Email verified!</h2>
          <p>{message}</p>
          <a href="/">Sign in</a>
        </div>
      )}
      {status === "error" && (
        <div style={{ textAlign:"center" }}>
          <h2>✗ Error</h2>
          <p>{message}</p>
        </div>
      )}
    </div>
  )
}