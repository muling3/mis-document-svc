import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DocumentsController } from './documents.controller';
import { BadHashBlocklist } from './bad-hash-blocklist.service';
import { KafkaProducerService } from './kafka-producer.service';
import { MongoService } from './mongo.service';
import { QuarantineService } from './quarantine.service';
import { SandboxClient } from './sandbox-client.service';
import { ScanProgressConsumer } from './scan-progress-consumer.service';
import { VerdictConsumer } from './verdict-consumer.service';

@Module({
  controllers: [AppController, DocumentsController],
  providers: [
    MongoService,
    QuarantineService,
    KafkaProducerService,
    SandboxClient,
    BadHashBlocklist,
    ScanProgressConsumer,
    VerdictConsumer,
  ],
})
export class AppModule {}
