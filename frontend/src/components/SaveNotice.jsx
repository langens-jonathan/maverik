// Shared save-feedback banner for the config editors: a "bootstrapped from example" info notice
// on first load of a file that didn't exist yet, and a notice reflecting the outcome of the last
// save — applied live, applied with a warning (e.g. some models failed to init), saved but
// couldn't apply live (previous config still active), or saved and needs a container restart
// (mcp-servers.json only, for now). Both notices are dismissable since they're one-off
// acknowledgements.
function resultNotice(result) {
  if (!result) return null;
  if (result.restartRequired)
    return { cls: "info", text: "Saved. Restart the maverik container for changes to take effect." };
  if (result.applied && !result.message)
    return { cls: "ok", text: "Saved and applied immediately — no restart needed." };
  if (result.applied)
    return { cls: "warn", text: result.message };
  return { cls: "bad", text: result.message ?? "Saved, but couldn't apply live." };
}

export function SaveNotice({ bootstrapped, onDismissBootstrapped, result, onDismissResult }) {
  const notice = resultNotice(result);
  return (
    <>
      {bootstrapped && (
        <div className="notice info">
          <span>This file didn't exist yet — showing the example template. Save to create it.</span>
          <button className="secondary" onClick={onDismissBootstrapped}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className={`notice ${notice.cls}`}>
          <span>{notice.text}</span>
          <button className="secondary" onClick={onDismissResult}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
