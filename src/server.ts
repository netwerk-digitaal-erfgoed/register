import fastify, {FastifyReply} from 'fastify';
import {ShaclValidator} from './validator';
import {StreamWriter} from 'n3';
import {toStream} from 'rdf-dataset-ext';
import {fetch, NoDatasetFoundAtUrl, UrlNotFound} from './fetch';
import {GraphDbDataStore} from './store';
import DatasetExt from 'rdf-ext/lib/Dataset';
import {URL} from 'url';

const server = fastify({logger: process.env.LOG ? !!+process.env.LOG : true});
const datastore = new GraphDbDataStore(
  process.env.GRAPHDB_URL || 'http://localhost:7200',
  'registry',
  process.env.GRAPHDB_USERNAME,
  process.env.GRAPHDB_PASSWORD
);

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

async function validate(
  url: URL,
  reply: FastifyReply
): Promise<DatasetExt[] | null> {
  let datasets: DatasetExt[];
  try {
    datasets = await fetch(url);
  } catch (e) {
    if (e instanceof UrlNotFound) {
      reply.code(404).send('URL not found: ' + url);
    }
    if (e instanceof NoDatasetFoundAtUrl) {
      reply.code(406).send(e.message);
    }
    return null;
  }

  // Validate each dataset using SHACL. Return validation result for the first datasets that is invalid.
  for (const dataset of datasets) {
    const queryResultValidationReport = await validator.validate(dataset);
    if (!queryResultValidationReport.conforms) {
      const streamWriter = new StreamWriter();
      const validationRdf = streamWriter.import(
        toStream(queryResultValidationReport.dataset)
      );
      reply.code(400).send(validationRdf);
      return null;
    }
  }

  return datasets;
}

server.post('/datasets', datasetsRequest, async (request, reply) => {
  const url = new URL((request.body as {'@id': string})['@id']);
  request.log.info(url.toString());
  const datasets = await validate(url, reply);
  if (datasets) {
    datasets.forEach(dataset => datastore.store(dataset, url));

    reply.code(202).send();
  }
});

server.put('/datasets/validate', datasetsRequest, async (request, reply) => {
  const url = new URL((request.body as {'@id': string})['@id']);
  request.log.info(url.toString());
  if ((await validate(url, reply)) !== null) {
    reply.code(200).send();
  }
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
