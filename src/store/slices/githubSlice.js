// Repository preferences are per account/team. Credentials remain in memory.
const key = user => user?.id ? `navigator_github:v2:${encodeURIComponent(user.id)}:${encodeURIComponent(user.team_id || "")}` : null;
function load(user) {
  try { return JSON.parse(localStorage.getItem(key(user)) || "{}"); } catch { return {}; }
}
function save(data, user) {
  if (!key(user)) return;
  const {owner, repo, branch} = data;
  try { localStorage.setItem(key(user), JSON.stringify({owner, repo, branch})); } catch {}
}
export const createGithubSlice = (set, get) => ({
  githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main",
  loadGithubSettings: user => {
    const saved = load(user);
    set({githubToken: "", githubOwner: saved.owner || "", githubRepo: saved.repo || "", githubBranch: saved.branch || "main"});
  },
  setGithubSettings: (token, owner, repo, branch) => {
    const br = branch || get().githubBranch || "main";
    save({owner, repo, branch: br}, get().currentUser);
    set({githubToken: token, githubOwner: owner, githubRepo: repo, githubBranch: br});
  },
  setGithubBranch: branch => {
    save({...load(get().currentUser), branch}, get().currentUser);
    set({githubBranch: branch});
  },
  clearGithubSettings: () => {
    save({}, get().currentUser);
    set({githubToken: "", githubOwner: "", githubRepo: "", githubBranch: "main"});
  },
});
