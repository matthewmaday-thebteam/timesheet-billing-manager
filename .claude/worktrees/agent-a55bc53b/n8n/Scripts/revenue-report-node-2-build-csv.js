var data = $input.first().json;
var company = data.company;
var monthLabel = data.monthLabel;

var header = ['Company', 'Project', 'Task', 'Hours', 'Company Hours'];

var csvRows = [];

csvRows.push(['Customer Revenue Report - ' + monthLabel]);
csvRows.push(header);

function emptyRow() { return header.map(function() { return ''; }); }

var companyRow = emptyRow();
companyRow[0] = company.companyName;
companyRow[4] = company.companyHours.toFixed(2);
csvRows.push(companyRow);

for (var p = 0; p < company.projects.length; p++) {
  var project = company.projects[p];

  var projectRow = emptyRow();
  projectRow[0] = company.companyName;
  projectRow[1] = project.projectName;
  csvRows.push(projectRow);

  for (var t = 0; t < project.tasks.length; t++) {
    var task = project.tasks[t];
    var taskRow = emptyRow();
    taskRow[0] = company.companyName;
    taskRow[1] = project.projectName;
    taskRow[2] = task.taskName;
    taskRow[3] = task.hours.toFixed(2);
    csvRows.push(taskRow);
  }
}

csvRows.push(emptyRow());

var totalRow = emptyRow();
totalRow[0] = 'TOTAL';
totalRow[4] = data.totalHours.toFixed(2);
csvRows.push(totalRow);

var csvContent = '\uFEFF' + csvRows.map(function(row) {
  return row.map(function(cell) {
    return '"' + String(cell).replace(/"/g, '""') + '"';
  }).join(',');
}).join('\n');

var filename = 'customer-revenue-neocurrency-' + data.month + '.csv';

var buffer = Buffer.from(csvContent, 'utf-8');

return [{
  json: {
    monthLabel: monthLabel,
    filename: filename,
    csvContent: csvContent
  },
  binary: {
    attachment: await this.helpers.prepareBinaryData(buffer, filename, 'text/csv; charset=utf-8')
  }
}];
