<?php

namespace App\Providers;

use App\Services\Billing\FakePaymentProvider;
use App\Services\Billing\PaymentProvider;
use App\Services\Billing\RazorpayPaymentProvider;
use Illuminate\Support\ServiceProvider;

class BillingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PaymentProvider::class, function () {
            return match (config('services.payment_provider')) {
                'razorpay' => new RazorpayPaymentProvider,
                default => new FakePaymentProvider,
            };
        });
    }

    public function boot(): void
    {
        //
    }
}
