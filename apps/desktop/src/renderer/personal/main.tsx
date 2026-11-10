import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@agentstudio/personal/ui";
import { desktopBridge } from "@agentstudio/personal/native";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@agentstudio/personal/styles.css";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    {desktopBridge() ? (
      <App />
    ) : (
      <div className="native-startup-error" role="alert">
        <h1>工作间没有启动</h1>
        <p>请退出后重新打开 AgentStudio。已保存的事情不会删除。</p>
      </div>
    )}
  </StrictMode>,
);
