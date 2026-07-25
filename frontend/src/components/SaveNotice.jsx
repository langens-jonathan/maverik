// Shared save-feedback banner for the config editors: shows a "bootstrapped from example"
// info notice on first load of a file that didn't exist yet, and a "saved, restart required"
// notice after a successful PUT — both dismissable since they're one-off acknowledgements.
export function SaveNotice({ bootstrapped, onDismissBootstrapped, saved, onDismissSaved }) {
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
      {saved && (
        <div className="notice ok">
          <span>Saved. Restart the maverik container for changes to take effect.</span>
          <button className="secondary" onClick={onDismissSaved}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
