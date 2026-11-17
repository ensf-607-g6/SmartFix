"""Create the SmartFix RabbitMQ topology (SF-02, NFR-3).

    python -m scripts.setup_rabbitmq              # uses RABBITMQ_URL from backend/.env
    python -m scripts.setup_rabbitmq --url amqps://user:pass@host/vhost
    python -m scripts.setup_rabbitmq --dry-run    # print the topology, no broker needed
    python -m scripts.setup_rabbitmq --reset      # delete everything first (drops queued messages!)

Safe to run again: declaring an existing exchange or queue with the same settings is a no-op.
"""
import argparse
import asyncio
import sys

from app.events.topology import (BINDINGS, DEAD_LETTER_EXCHANGE, DEAD_LETTER_QUEUE, EXCHANGE,
                                 queue_arguments, queue_name, routing_keys)


def describe() -> None:
    print(f"exchange  {EXCHANGE}  (topic, durable)")
    print(f"exchange  {DEAD_LETTER_EXCHANGE}  (fanout, durable)")
    print(f"queue     {DEAD_LETTER_QUEUE}  <- {DEAD_LETTER_EXCHANGE}")
    for consumer in BINDINGS:
        print(f"queue     {queue_name(consumer)}  args={queue_arguments(consumer)}")
        for key in routing_keys(consumer):
            print(f"            bind {EXCHANGE} -> {key}")


async def setup(url: str, reset: bool) -> None:
    import aio_pika

    connection = await aio_pika.connect(url)
    async with connection:
        channel = await connection.channel()

        if reset:
            for consumer in BINDINGS:
                await channel.queue_delete(queue_name(consumer))
            await channel.queue_delete(DEAD_LETTER_QUEUE)
            await channel.exchange_delete(EXCHANGE)
            await channel.exchange_delete(DEAD_LETTER_EXCHANGE)
            print("deleted existing topology")

        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
        dlx = await channel.declare_exchange(DEAD_LETTER_EXCHANGE, aio_pika.ExchangeType.FANOUT,
                                             durable=True)
        dead_letter = await channel.declare_queue(DEAD_LETTER_QUEUE, durable=True)
        await dead_letter.bind(dlx)

        for consumer in BINDINGS:
            queue = await channel.declare_queue(queue_name(consumer), durable=True,
                                                arguments=queue_arguments(consumer))
            for key in routing_keys(consumer):
                await queue.bind(exchange, routing_key=key)
    describe()
    print("topology ready")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", help="AMQP URL (default: RABBITMQ_URL from backend/.env)")
    parser.add_argument("--reset", action="store_true", help="delete queues and exchanges first")
    parser.add_argument("--dry-run", action="store_true", help="print the topology and exit")
    args = parser.parse_args()

    if args.dry_run:
        describe()
        return 0

    url = args.url
    if not url:
        from app.config import get_settings
        url = get_settings().rabbitmq_url
    if not url:
        print("RABBITMQ_URL is empty: set it in backend/.env or pass --url", file=sys.stderr)
        return 1

    try:
        asyncio.run(setup(url, args.reset))
    except OSError as exc:
        print(f"could not reach RabbitMQ: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
