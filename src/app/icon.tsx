import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(120% 120% at 30% 20%, #A78BFA 0%, #6D28D9 38%, #0B1020 100%)",
        }}
      >
        <div
          style={{
            width: 420,
            height: 420,
            borderRadius: 96,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 250,
              height: 140,
              borderRadius: 48,
              background: "#0A0F1D",
              position: "absolute",
              top: 90,
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
          />
          <div
            style={{
              width: 320,
              height: 44,
              borderRadius: 999,
              background: "#0A0F1D",
              position: "absolute",
              top: 190,
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 108,
              width: 280,
              display: "flex",
              justifyContent: "space-between",
              color: "white",
              fontSize: 54,
              fontWeight: 800,
              letterSpacing: -2,
              opacity: 0.95,
            }}
          >
            <span>M</span>
            <span>F</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
