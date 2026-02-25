var csvContent = $input.first().json.csvContent;
var filename = $input.first().json.filename;
var monthLabel = $input.first().json.monthLabel;

var base64Content = Buffer.from(csvContent, 'utf-8').toString('base64');

return [{
  json: {
    message: {
      subject: 'Neocurrency Revenue Report - ' + monthLabel,
      body: {
        contentType: 'Text',
        content: 'Hi Stanimir,\n\nAttached is the Neocurrency customer revenue report for ' + monthLabel + '.\n\nThis is an automated report generated every Monday morning.\n\nBest,\nThe B Team'
      },
      toRecipients: [
        {
          emailAddress: {
            address: 'sdimitrov@yourbteam.com'
          }
        }
      ],
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: filename,
          contentType: 'text/csv',
          contentBytes: base64Content
        }
      ]
    }
  }
}];
