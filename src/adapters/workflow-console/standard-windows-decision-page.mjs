const subject = document.getElementById("subject");
const form = document.getElementById("decision");
const inputs = document.getElementById("fields");
const options = document.getElementById("choices");
const status = document.getElementById("status");

async function request(path, data) {
  const response = await fetch("./" + path, data === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.code ?? "OPERATOR_PANEL_UNAVAILABLE");
  return result;
}

function show(state) {
  if (state.status === "received") {
    status.textContent = "Décision enregistrée : " + state.choice;
    form.hidden = true;
    return;
  }
  if (state.status !== "question") {
    status.textContent = state.status === "retained" ? "La réponse est conservée. AIDN reprend son traitement."
      : "Aucune décision n’est attendue ici.";
    return;
  }
  if (typeof globalThis.PublicKeyCredential?.parseRequestOptionsFromJSON !== "function") throw Error("STANDARD_WINDOWS_OPERATOR_UNAVAILABLE");
  subject.textContent = state.message;
  const { properties, required } = state.requestedSchema;
  for (const [key, item] of Object.entries(properties)) {
    if (key === "choice") continue;
    const label = document.createElement("label");
    label.className = "field";
    label.textContent = item.title;
    const control = document.createElement(item.enum ? "select" : item.description ? "textarea" : "input");
    control.name = key;
    control.required = required.includes(key);
    if (item.maxLength) control.maxLength = item.maxLength;
    for (const choice of item.enum ?? []) control.add(new Option(choice, choice));
    label.append(control);
    inputs.append(label);
  }
  for (const choice of properties.choice.enum) {
    const button = document.createElement("button");
    button.type = "submit";
    button.value = choice;
    button.textContent = choice;
    options.append(button);
  }
  form.hidden = false;
  status.textContent = "";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    fields.choice = event.submitter?.value;
    if (!fields.choice) return;
    const buttons = [...options.querySelectorAll("button")];
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = "Vérification Windows en cours…";
    try {
      const challenged = await request("challenge", { question_sha256: state.question_sha256, fields });
      const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(challenged.options);
      const credential = (await navigator.credentials.get({ publicKey })).toJSON();
      show(await request("confirm", { nonce: challenged.nonce, assertion: {
        id: credential.id, client_data: credential.response.clientDataJSON,
        authenticator_data: credential.response.authenticatorData, signature: credential.response.signature,
      } }));
    } catch (error) {
      status.textContent = error.name === "NotAllowedError" ? "La vérification Windows s’est interrompue."
        : "La décision attend toujours sa vérification par AIDN.";
      buttons.forEach(button => { button.disabled = false; });
    }
  });
}

try { show(await request("offer")); }
catch { status.textContent = "AIDN ne peut pas afficher la question pour le moment."; }
