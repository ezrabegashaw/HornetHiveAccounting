// Asigns the <aside> tag by the id and then copies the basic UI file.
function loadUI(id, file) {
    fetch(file)
        .then(response => response.text())
        .then(data => {document.getElementById(id).innerHTML = data;})
}