// Shared "doesn't exist" state — used both for a resolved route whose id the API 404'd on
// (RunDetailPage/SuiteDetailPage) and as the catch-all for a URL that doesn't match any route.
export function NotFound({ title = "404", message = "Not found." }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="muted">{message}</p>
    </div>
  );
}
