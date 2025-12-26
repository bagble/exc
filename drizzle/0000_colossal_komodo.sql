CREATE TABLE "portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(50) NOT NULL,
	"detail" text,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"balance" double precision DEFAULT 0,
	"holdings" jsonb DEFAULT '[]',
	"listing_callauction_symbols" jsonb DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"detail" text,
	"url" text,
	"logo" text,
	"market" varchar(100) NOT NULL,
	"type" varchar(100) DEFAULT 'stock',
	"minimum_order_quantity" double precision DEFAULT 1,
	"tick_size" double precision DEFAULT 1,
	"total_shares" bigint DEFAULT 0,
	"ipo_price" double precision DEFAULT 0,
	"tags" jsonb DEFAULT '[]',
	"status" jsonb DEFAULT '{"status": "init", "reason": ""}',
	CONSTRAINT "symbols_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"admin" boolean DEFAULT false,
	"demo" boolean DEFAULT false,
	"fee" double precision,
	"active" boolean DEFAULT false,
	"level" integer DEFAULT 0,
	"email_verified" boolean DEFAULT false,
	CONSTRAINT "users_name_unique" UNIQUE("name"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;