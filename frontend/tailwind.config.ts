export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card: "var(--bg-card)",
          hover: "var(--bg-hover)",
          dark: "var(--bg-primary)",
        },
        accent: {
          red: "var(--accent-red)",
          blue: "var(--accent-blue)",
          yellow: "var(--accent-yellow)",
          green: "var(--accent-green)",
          purple: "var(--accent-purple)",
        },
        border: {
          subtle: "var(--border-subtle)",
          active: "var(--border-active)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          faint: "var(--text-faint)",
        },
      },
      animation: {
        // Functional UI feedback animations kept for the main app:
        // - flash: highlights a Pokemon row when it's auto-detected
        // - slide-in: modal entrance
        // - float: legacy sprite idle option still referenced by Overlay.tsx
        flash: "flash 0.4s ease-out",
        "slide-in": "slideIn 0.2s ease-out",
        float: "float 3s ease-in-out infinite",
        "overlay-fade-in": "overlay-fade-in 0.4s ease-out",
        "overlay-slide-in": "overlay-slide-in 0.3s ease-out",
        // Counter / sprite / name trigger animations
        "overlay-pop": "overlay-pop 0.3s ease-out",
        "overlay-flash": "overlay-flash 0.45s ease-out",
        "overlay-bounce": "overlay-bounce 0.5s ease-out",
        "overlay-shake": "overlay-shake 0.4s ease-out",
        "overlay-slide-up": "overlay-slide-up 0.3s ease-out",
        "overlay-slide-down": "overlay-slide-down 0.3s ease-out",
        "overlay-flip": "overlay-flip 0.45s ease-in-out",
        "overlay-rubber": "overlay-rubber 0.55s ease-out",
        "overlay-spin": "overlay-spin 0.6s ease-in-out",
        // Idle animations
        "overlay-pulse-idle": "overlay-pulse-idle 2s ease-in-out infinite",
        "overlay-rock": "overlay-rock 2.5s ease-in-out infinite",
        "overlay-bob": "overlay-bob 1.6s ease-in-out infinite",
        "overlay-breathe": "overlay-breathe 3s ease-in-out infinite",
        "overlay-glow": "overlay-glow 2s ease-in-out infinite",
        // New idle animations
        "overlay-wiggle": "overlay-wiggle 1.5s ease-in-out infinite",
        "overlay-shimmer-idle": "overlay-shimmer-idle 2s linear infinite",
        "overlay-text-shimmer": "overlay-text-shimmer 2.5s linear infinite",
        "overlay-text-float": "overlay-text-float 3s ease-in-out infinite",
        // New trigger animations
        "overlay-jello": "overlay-jello 0.7s ease-out",
        "overlay-tada": "overlay-tada 0.6s ease-out",
        "overlay-swing": "overlay-swing 0.6s ease-out",
        "overlay-zoom-in": "overlay-zoom-in 0.4s ease-out",
      },
      keyframes: {
        flash: {
          "0%, 100%": { backgroundColor: "transparent" },
          "50%": { backgroundColor: "rgba(74, 158, 255, 0.3)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "overlay-fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "overlay-slide-in": {
          "0%": { transform: "translateX(-20px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "overlay-pop": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.45)" },
          "100%": { transform: "scale(1)" },
        },
        "overlay-flash": {
          "0%, 100%": { filter: "brightness(1)" },
          "50%": {
            filter:
              "brightness(2.5) drop-shadow(0 0 12px rgba(255,230,80,0.9))",
          },
        },
        "overlay-bounce": {
          "0%": { transform: "translateY(0)" },
          "25%": { transform: "translateY(-22px)" },
          "50%": { transform: "translateY(0)" },
          "68%": { transform: "translateY(-10px)" },
          "82%": { transform: "translateY(0)" },
          "91%": { transform: "translateY(-4px)" },
          "100%": { transform: "translateY(0)" },
        },
        "overlay-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "15%": { transform: "translateX(-9px)" },
          "30%": { transform: "translateX(9px)" },
          "45%": { transform: "translateX(-6px)" },
          "60%": { transform: "translateX(6px)" },
          "75%": { transform: "translateX(-3px)" },
          "90%": { transform: "translateX(3px)" },
        },
        "overlay-slide-up": {
          "0%": { transform: "translateY(40px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "overlay-slide-down": {
          "0%": { transform: "translateY(-40px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "overlay-flip": {
          "0%": { transform: "perspective(300px) rotateX(0deg)", opacity: "1" },
          "42%": {
            transform: "perspective(300px) rotateX(-92deg)",
            opacity: "0",
          },
          "58%": {
            transform: "perspective(300px) rotateX(92deg)",
            opacity: "0",
          },
          "100%": {
            transform: "perspective(300px) rotateX(0deg)",
            opacity: "1",
          },
        },
        "overlay-spin": {
          "0%": { transform: "rotate(0deg) scale(1)" },
          "50%": { transform: "rotate(200deg) scale(1.18)" },
          "100%": { transform: "rotate(360deg) scale(1)" },
        },
        "overlay-pulse-idle": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.09)" },
        },
        "overlay-rock": {
          "0%, 100%": { transform: "rotate(-5deg)" },
          "50%": { transform: "rotate(5deg)" },
        },
        "overlay-bob": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        "overlay-breathe": {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.03)", opacity: "1" },
        },
        "overlay-glow": {
          "0%, 100%": { filter: "brightness(1)" },
          "50%": {
            filter:
              "brightness(1.6) drop-shadow(0 0 8px rgba(255,255,255,0.55))",
          },
        },
        "overlay-rubber": {
          "0%": { transform: "scaleX(1)    scaleY(1)" },
          "28%": { transform: "scaleX(1.42) scaleY(0.62)" },
          "48%": { transform: "scaleX(0.80) scaleY(1.18)" },
          "68%": { transform: "scaleX(1.12) scaleY(0.9)" },
          "84%": { transform: "scaleX(0.96) scaleY(1.04)" },
          "100%": { transform: "scaleX(1)    scaleY(1)" },
        },
        // Sprite idle: wiggle
        "overlay-wiggle": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-5deg)" },
          "75%": { transform: "rotate(5deg)" },
        },
        // Sprite idle: shimmer (brightness cycling)
        "overlay-shimmer-idle": {
          "0%, 100%": { filter: "brightness(1)" },
          "50%": { filter: "brightness(1.4)" },
        },
        // Text idle: shimmer sweep
        "overlay-text-shimmer": {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
        // Text idle: float
        "overlay-text-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        // Trigger: jello
        "overlay-jello": {
          "0%": { transform: "scale3d(1,1,1)" },
          "30%": { transform: "scale3d(1.25,0.75,1)" },
          "40%": { transform: "scale3d(0.75,1.25,1)" },
          "50%": { transform: "scale3d(1.15,0.85,1)" },
          "65%": { transform: "scale3d(0.95,1.05,1)" },
          "75%": { transform: "scale3d(1.05,0.95,1)" },
          "100%": { transform: "scale3d(1,1,1)" },
        },
        // Trigger: tada
        "overlay-tada": {
          "0%": { transform: "scale(1) rotate(0deg)" },
          "10%, 20%": { transform: "scale(0.9) rotate(-3deg)" },
          "30%, 50%, 70%, 90%": { transform: "scale(1.1) rotate(3deg)" },
          "40%, 60%, 80%": { transform: "scale(1.1) rotate(-3deg)" },
          "100%": { transform: "scale(1) rotate(0deg)" },
        },
        // Trigger: swing
        "overlay-swing": {
          "0%": { transform: "rotate(0deg)" },
          "20%": { transform: "rotate(15deg)" },
          "40%": { transform: "rotate(-10deg)" },
          "60%": { transform: "rotate(5deg)" },
          "80%": { transform: "rotate(-5deg)" },
          "100%": { transform: "rotate(0deg)" },
        },
        // Trigger: zoom-in
        "overlay-zoom-in": {
          "0%": { transform: "scale(0)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  safelist: [
    // Dynamically resolved via JS objects in Overlay.tsx — must not be purged
    "animate-overlay-pulse-idle",
    "animate-overlay-rock",
    "animate-overlay-bob",
    "animate-overlay-breathe",
    "animate-overlay-glow",
    "animate-overlay-spin",
    "animate-overlay-pop",
    "animate-overlay-flash",
    "animate-overlay-bounce",
    "animate-overlay-shake",
    "animate-overlay-slide-up",
    "animate-overlay-slide-down",
    "animate-overlay-flip",
    "animate-overlay-rubber",
    "animate-overlay-fade-in",
    "animate-overlay-slide-in",
    "animate-float",
    "animate-overlay-wiggle",
    "animate-overlay-shimmer-idle",
    "animate-overlay-text-shimmer",
    "animate-overlay-text-float",
    "animate-overlay-jello",
    "animate-overlay-tada",
    "animate-overlay-swing",
    "animate-overlay-zoom-in",
  ],
  plugins: [],
};
