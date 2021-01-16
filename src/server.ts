import fastify from 'fastify';
import {ShaclValidator} from './validator';
import * as https from 'https';
import {StreamWriter} from 'n3';
import {toStream} from 'rdf-dataset-ext';
import {fetch} from './fetch';

const server = fastify();

const datasetsRequest = {
  schema: {
    body: {
      type: 'object',
      required: ['@id'],
      properties: {
        '@id': {type: 'string'},
      },
    },
  },
};

server.post('/datasets', datasetsRequest, async (request, reply) => {
  const url = (request.body as {'@id': string})['@id'];

  https.get(url, async res => {
    // Ensure the dataset description URL exists.
    if (res.statusCode! < 200 || res.statusCode! > 400) {
      console.log('not found');
      reply.code(404).send('No dataset description found at ' + url);
      return;
    }

    // Fetch dataset description.
    const dataset = await fetch(url);

    if (dataset.size === 0) {
      reply.code(400).send();
      return;
    }

    // Validate dataset description using SHACL.
    const queryResultValidationReport = await validator.validate(dataset);
    if (!queryResultValidationReport.conforms) {
      const streamWriter = new StreamWriter();
      const validationRdf = streamWriter.import(
        toStream(queryResultValidationReport.dataset)
      );
      reply.code(400).send(validationRdf);
      return;
    }

    reply.code(202).send();
  });
});

/**
 * Make Fastify accept JSON-LD payloads.
 */
server.addContentTypeParser(
  'application/ld+json',
  {parseAs: 'string'},
  (req, body: string, done) => {
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  }
);

let validator: ShaclValidator;

(async () => {
  try {
    validator = await ShaclValidator.fromUrl('shacl/dataset.jsonld');
    await server.listen(3000, '0.0.0.0');
  } catch (err) {
    console.error(err);
  }
})();
